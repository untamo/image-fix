const MAX_PIXELS = 12000000;
const MAX_DIMENSION = 2600;

const state = {
  sourceImageData: null,
  workingImageData: null,
  detections: [],
  history: [],
  guidesVisible: true,
  fileBaseName: "cleaned-image",
};

const elements = {
  fileInput: document.querySelector("#fileInput"),
  chooseButton: document.querySelector("#chooseButton"),
  dropzone: document.querySelector("#dropzone"),
  canvasArea: document.querySelector("#canvasArea"),
  canvasStage: document.querySelector("#canvasStage"),
  previewCanvas: document.querySelector("#previewCanvas"),
  guideCanvas: document.querySelector("#guideCanvas"),
  workspaceHeading: document.querySelector("#workspaceHeading"),
  statusChip: document.querySelector("#statusChip"),
  statusText: document.querySelector("#statusText"),
  guideSummary: document.querySelector("#guideSummary"),
  errorNotice: document.querySelector("#errorNotice"),
  sensitivity: document.querySelector("#sensitivity"),
  sensitivityValue: document.querySelector("#sensitivityValue"),
  lineCount: document.querySelector("#lineCount"),
  lineCoverage: document.querySelector("#lineCoverage"),
  detectionStatus: document.querySelector("#detectionStatus"),
  detectButton: document.querySelector("#detectButton"),
  removeButton: document.querySelector("#removeButton"),
  undoButton: document.querySelector("#undoButton"),
  resetButton: document.querySelector("#resetButton"),
  downloadButton: document.querySelector("#downloadButton"),
  toggleGuidesButton: document.querySelector("#toggleGuidesButton"),
};

const previewContext = elements.previewCanvas.getContext("2d", { willReadFrequently: true });
const guideContext = elements.guideCanvas.getContext("2d");

function cloneImageData(imageData) {
  const copy = new ImageData(imageData.width, imageData.height);
  copy.data.set(imageData.data);
  return copy;
}

function setStatus(message, tone = "neutral") {
  elements.statusText.textContent = message;
  elements.statusChip.dataset.tone = tone;
}

function setError(message = "") {
  elements.errorNotice.textContent = message;
  elements.errorNotice.classList.toggle("hidden", !message);
  if (message) {
    setStatus("Something went wrong", "error");
  }
}

function setDetectionStatus(message, tone = "neutral") {
  elements.detectionStatus.textContent = message;
  elements.detectionStatus.dataset.tone = tone;
}

function hasImage() {
  return Boolean(state.workingImageData);
}

function updateControls() {
  const loaded = hasImage();
  elements.detectButton.disabled = !loaded;
  elements.removeButton.disabled = !loaded || state.detections.length === 0;
  elements.undoButton.disabled = !loaded || state.history.length === 0;
  elements.resetButton.disabled = !loaded;
  elements.downloadButton.disabled = !loaded;
  elements.toggleGuidesButton.disabled = !loaded;
}

function updateDetectionSummary() {
  const count = state.detections.length;
  elements.lineCount.textContent = String(count);

  if (!hasImage()) {
    elements.lineCoverage.textContent = "Upload an image to begin detection.";
    elements.guideSummary.textContent = "Detected lines will appear as guides";
    setDetectionStatus("Waiting");
    updateControls();
    return;
  }

  if (count === 0) {
    elements.lineCoverage.textContent = "No strong full-height vertical lines found at this sensitivity.";
    elements.guideSummary.textContent = "No vertical lines detected";
    setDetectionStatus("Clear", "success");
  } else {
    const totalWidth = state.detections.reduce((sum, line) => sum + line.width, 0);
    elements.lineCoverage.textContent = `${totalWidth}px across ${count} candidate${count === 1 ? "" : "s"}. Review the guides before removing.`;
    elements.guideSummary.textContent = `${count} candidate line${count === 1 ? "" : "s"} highlighted`;
    setDetectionStatus("Review", "success");
  }

  updateControls();
}

function drawGuides() {
  if (!state.workingImageData) {
    guideContext.clearRect(0, 0, elements.guideCanvas.width, elements.guideCanvas.height);
    return;
  }

  guideContext.clearRect(0, 0, elements.guideCanvas.width, elements.guideCanvas.height);
  if (!state.guidesVisible) return;

  const { width, height } = state.workingImageData;
  state.detections.forEach((line) => {
    guideContext.fillStyle = "rgba(194, 245, 109, 0.15)";
    guideContext.strokeStyle = "rgba(220, 255, 157, 0.95)";
    guideContext.lineWidth = Math.max(1, Math.min(3, width / 900));
    guideContext.setLineDash([5, 4]);
    guideContext.fillRect(line.start, 0, line.width, height);
    guideContext.strokeRect(line.start + 0.5, 0.5, Math.max(1, line.width - 1), Math.max(1, height - 1));
  });
  guideContext.setLineDash([]);
}

function renderWorkingImage() {
  if (!state.workingImageData) return;
  const { width, height } = state.workingImageData;
  elements.previewCanvas.width = width;
  elements.previewCanvas.height = height;
  elements.guideCanvas.width = width;
  elements.guideCanvas.height = height;
  previewContext.putImageData(state.workingImageData, 0, 0);
  drawGuides();
}

function luminance(red, green, blue) {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function detectVerticalLines(imageData, sensitivity) {
  const { width, height, data } = imageData;
  if (width < 5 || height < 12) return [];

  const luma = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = (y * width + x) * 4;
      luma[y * width + x] = luminance(data[pixel], data[pixel + 1], data[pixel + 2]);
    }
  }

  const responses = new Float32Array(width);
  const coverage = new Float32Array(width);
  const pixelThreshold = 9 + ((100 - sensitivity) / 100) * 20;

  for (let x = 1; x < width - 1; x += 1) {
    let responseTotal = 0;
    let hitCount = 0;

    for (let y = 0; y < height; y += 1) {
      const index = y * width + x;
      const neighbourAverage = (luma[index - 1] + luma[index + 1]) / 2;
      const difference = Math.abs(luma[index] - neighbourAverage);
      responseTotal += difference;
      if (difference >= pixelThreshold) hitCount += 1;
    }

    responses[x] = responseTotal / height;
    coverage[x] = hitCount / height;
  }

  const responseValues = Array.from(responses.slice(1, width - 1));
  const responseMedian = median(responseValues);
  const deviation = responseValues.map((value) => Math.abs(value - responseMedian));
  const noiseScale = Math.max(1.5, median(deviation) * 1.4826);
  const strictness = 3.2 - (sensitivity / 100) * 1.8;
  const responseThreshold = responseMedian + noiseScale * strictness;
  const coverageThreshold = 0.18 + ((100 - sensitivity) / 100) * 0.2;
  const candidates = new Uint8Array(width);

  for (let x = 2; x < width - 2; x += 1) {
    candidates[x] = responses[x] >= responseThreshold && coverage[x] >= coverageThreshold ? 1 : 0;
  }

  const lines = [];
  let start = -1;
  const maxLineWidth = Math.max(8, Math.min(48, Math.round(width * 0.012)));

  const finishLine = (end) => {
    if (start < 0) return;
    const widthOfLine = end - start + 1;
    if (widthOfLine <= maxLineWidth) {
      lines.push({ start, end, width: widthOfLine });
    }
    start = -1;
  };

  for (let x = 2; x < width - 2; x += 1) {
    if (candidates[x]) {
      if (start < 0) start = x;
    } else if (start >= 0) {
      finishLine(x - 1);
    }
  }
  finishLine(width - 3);

  return mergeNearbyLines(lines, width);
}

function mergeNearbyLines(lines, imageWidth) {
  if (lines.length < 2) return lines;
  const merged = [];
  const gapLimit = Math.max(2, Math.round(imageWidth * 0.0015));

  lines.forEach((line) => {
    const previous = merged[merged.length - 1];
    if (previous && line.start - previous.end - 1 <= gapLimit) {
      previous.end = line.end;
      previous.width = previous.end - previous.start + 1;
    } else {
      merged.push({ ...line });
    }
  });

  return merged;
}

function runDetection({ announce = true } = {}) {
  if (!state.sourceImageData) return;
  const sensitivity = Number(elements.sensitivity.value);
  state.detections = detectVerticalLines(state.sourceImageData, sensitivity);
  drawGuides();
  updateDetectionSummary();
  if (announce) {
    setStatus(state.detections.length ? "Guides ready" : "No guides found", state.detections.length ? "success" : "neutral");
  }
}

function removeDetectedLines() {
  if (!state.workingImageData || !state.detections.length) return;

  state.history.push({
    imageData: cloneImageData(state.workingImageData),
    detections: state.detections.map((line) => ({ ...line })),
  });

  const cleaned = cloneImageData(state.workingImageData);
  const { width, height, data } = cleaned;
  const removedCount = state.detections.length;

  state.detections.forEach((line) => {
    const padding = Math.max(2, Math.min(12, Math.ceil(line.width * 0.8)));
    const left = Math.max(0, line.start - padding);
    const right = Math.min(width - 1, line.end + padding);

    for (let y = 0; y < height; y += 1) {
      const leftPixel = (y * width + left) * 4;
      const rightPixel = (y * width + right) * 4;
      for (let x = line.start; x <= line.end; x += 1) {
        const destination = (y * width + x) * 4;
        const proportion = right === left ? 0 : (x - left) / (right - left);
        data[destination] = Math.round(data[leftPixel] * (1 - proportion) + data[rightPixel] * proportion);
        data[destination + 1] = Math.round(data[leftPixel + 1] * (1 - proportion) + data[rightPixel + 1] * proportion);
        data[destination + 2] = Math.round(data[leftPixel + 2] * (1 - proportion) + data[rightPixel + 2] * proportion);
        data[destination + 3] = Math.round(data[leftPixel + 3] * (1 - proportion) + data[rightPixel + 3] * proportion);
      }
    }
  });

  state.workingImageData = cleaned;
  state.detections = [];
  renderWorkingImage();
  updateDetectionSummary();
  setStatus(`Removed ${removedCount} line${removedCount === 1 ? "" : "s"}`, "success");
}

function undoLastEdit() {
  const previous = state.history.pop();
  if (!previous) return;
  state.workingImageData = previous.imageData;
  state.detections = previous.detections;
  renderWorkingImage();
  updateDetectionSummary();
  setStatus("Last edit undone", "success");
}

function resetImage() {
  if (!state.sourceImageData) return;
  state.history = [];
  state.workingImageData = cloneImageData(state.sourceImageData);
  renderWorkingImage();
  runDetection();
  setStatus("Image reset", "success");
}

function setLoadedState(file, width, height) {
  state.fileBaseName = file.name.replace(/\.[^/.]+$/, "") || "cleaned-image";
  elements.workspaceHeading.textContent = file.name;
  elements.canvasArea.classList.remove("hidden");
  elements.dropzone.classList.add("hidden");
  elements.toggleGuidesButton.textContent = "Hide guides";
  elements.toggleGuidesButton.setAttribute("aria-pressed", "true");
  state.guidesVisible = true;
  setStatus(`Loaded ${width} × ${height}`, "success");
  updateControls();
}

function loadImageFile(file) {
  if (!file) return;
  setError();

  if (!file.type.startsWith("image/")) {
    setError("Please choose a PNG, JPG, or WebP image.");
    return;
  }

  if (file.size > 20 * 1024 * 1024) {
    setError("That image is larger than 20 MB. Choose a smaller file.");
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  setStatus("Loading image…");

  image.onload = () => {
    const scale = Math.min(
      1,
      Math.sqrt(MAX_PIXELS / (image.naturalWidth * image.naturalHeight)),
      MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    elements.previewCanvas.width = width;
    elements.previewCanvas.height = height;
    elements.guideCanvas.width = width;
    elements.guideCanvas.height = height;
    previewContext.clearRect(0, 0, width, height);
    previewContext.drawImage(image, 0, 0, width, height);

    state.sourceImageData = previewContext.getImageData(0, 0, width, height);
    state.workingImageData = cloneImageData(state.sourceImageData);
    state.history = [];
    setLoadedState(file, width, height);
    renderWorkingImage();
    runDetection();
    URL.revokeObjectURL(objectUrl);
  };

  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    setError("This image could not be opened. Try another file.");
  };

  image.src = objectUrl;
}

function downloadImage() {
  if (!state.workingImageData) return;
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = state.workingImageData.width;
  exportCanvas.height = state.workingImageData.height;
  exportCanvas.getContext("2d").putImageData(state.workingImageData, 0, 0);
  exportCanvas.toBlob((blob) => {
    if (!blob) {
      setError("The cleaned image could not be exported.");
      return;
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${state.fileBaseName}-cleaned.png`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setStatus("PNG downloaded", "success");
  }, "image/png");
}

function toggleGuides() {
  state.guidesVisible = !state.guidesVisible;
  elements.toggleGuidesButton.textContent = state.guidesVisible ? "Hide guides" : "Show guides";
  elements.toggleGuidesButton.setAttribute("aria-pressed", String(state.guidesVisible));
  drawGuides();
}

elements.chooseButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", (event) => {
  loadImageFile(event.target.files[0]);
  event.target.value = "";
});
elements.detectButton.addEventListener("click", () => runDetection());
elements.removeButton.addEventListener("click", removeDetectedLines);
elements.undoButton.addEventListener("click", undoLastEdit);
elements.resetButton.addEventListener("click", resetImage);
elements.downloadButton.addEventListener("click", downloadImage);
elements.toggleGuidesButton.addEventListener("click", toggleGuides);

elements.sensitivity.addEventListener("input", () => {
  elements.sensitivityValue.textContent = `${elements.sensitivity.value}%`;
  if (state.sourceImageData) runDetection({ announce: false });
});

elements.dropzone.addEventListener("click", (event) => {
  if (event.target.closest("button")) return;
  elements.fileInput.click();
});

elements.dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    elements.fileInput.click();
  }
});

["dragenter", "dragover"].forEach((eventName) => {
  elements.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropzone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  elements.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropzone.classList.remove("is-dragging");
  });
});

elements.dropzone.addEventListener("drop", (event) => {
  loadImageFile(event.dataTransfer.files[0]);
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    undoLastEdit();
  }
});

elements.sensitivityValue.textContent = `${elements.sensitivity.value}%`;
updateDetectionSummary();
