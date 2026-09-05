const MAX_PIXELS = 12000000;
const MAX_DIMENSION = 2600;

const state = {
  sourceImageData: null,
  workingImageData: null,
  detections: [],
  history: [],
  guidesVisible: true,
  fileBaseName: "cleaned-image",
  orientation: "vertical",
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
  orientationInputs: Array.from(document.querySelectorAll('input[name="orientation"]')),
  directionHint: document.querySelector("#directionHint"),
  legacyOrientationButtons: Array.from(document.querySelectorAll("button[data-orientation]")),
  sensitivity: document.querySelector("#sensitivity"),
  sensitivityValue: document.querySelector("#sensitivityValue"),
  lineCount: document.querySelector("#lineCount"),
  lineCoverage: document.querySelector("#lineCoverage"),
  detectionStatus: document.querySelector("#detectionStatus"),
  detectButton: document.querySelector("#detectButton"),
  detectButtonLabel: document.querySelector("#detectButtonLabel"),
  removeButton: document.querySelector("#removeButton"),
  removeButtonLabel: document.querySelector("#removeButtonLabel"),
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

function directionDescription(orientation = state.orientation) {
  if (orientation === "both") return "vertical or horizontal";
  return orientation;
}

function detectionDescription(detections = state.detections) {
  const counts = detections.reduce(
    (summary, line) => {
      summary[line.orientation] = (summary[line.orientation] || 0) + 1;
      return summary;
    },
    { vertical: 0, horizontal: 0 },
  );

  const parts = [];
  if (counts.vertical) parts.push(`${counts.vertical} vertical`);
  if (counts.horizontal) parts.push(`${counts.horizontal} horizontal`);
  return parts.join(" + ");
}

function updateActionLabels() {
  const detectLabel = state.orientation === "both"
    ? "Detect both orientations"
    : `Detect ${state.orientation} lines`;
  const removeLabel = state.orientation === "both"
    ? "Remove detected lines"
    : `Remove detected ${state.orientation} lines`;

  elements.detectButtonLabel.textContent = detectLabel;
  elements.removeButtonLabel.textContent = removeLabel;

  elements.orientationInputs.forEach((input) => {
    input.checked = input.value === state.orientation;
  });
  if (elements.directionHint) {
    const label = state.orientation === "both" ? "Both directions" : state.orientation;
    elements.directionHint.textContent = `${label.charAt(0).toUpperCase()}${label.slice(1)} selected`;
  }
  // Keep a cached copy of the previous HTML usable until it is refreshed.
  elements.legacyOrientationButtons.forEach((button) => {
    const isActive = button.dataset.orientation === state.orientation;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function setOrientation(orientation) {
  if (!["vertical", "horizontal", "both"].includes(orientation)) return;
  state.orientation = orientation;
  updateActionLabels();
  if (hasImage()) {
    setGuidesVisible(true);
    runDetection();
  }
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
    elements.lineCoverage.textContent = `No strong ${directionDescription()} lines found at this sensitivity.`;
    elements.guideSummary.textContent = `No ${directionDescription()} lines detected`;
    setDetectionStatus("None found");
  } else {
    const summary = detectionDescription();
    elements.lineCoverage.textContent = `${summary} guide${count === 1 ? "" : "s"} highlighted. Review before removing.`;
    elements.guideSummary.textContent = `${summary} guide${count === 1 ? "" : "s"} ${state.guidesVisible ? "highlighted" : "hidden"}`;
    setDetectionStatus("Review", "success");
  }

  updateControls();
}

function drawGuides() {
  guideContext.setTransform(1, 0, 0, 1, 0, 0);
  guideContext.clearRect(0, 0, elements.guideCanvas.width, elements.guideCanvas.height);
  if (!state.workingImageData) {
    return;
  }

  // Use display pixels, not image pixels, so highlights stay bold on phones.
  const bounds = elements.previewCanvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  elements.guideCanvas.width = Math.round(bounds.width * pixelRatio);
  elements.guideCanvas.height = Math.round(bounds.height * pixelRatio);
  guideContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  if (!state.guidesVisible) return;

  const { width, height } = state.workingImageData;
  state.detections.forEach((line) => {
    const isVertical = line.orientation === "vertical";
    const color = isVertical ? "#c2f56d" : "#67d3ff";
    const scale = isVertical ? bounds.width / width : bounds.height / height;
    const center = (line.start + line.width / 2) * scale;
    const bandWidth = Math.max(10, line.width * scale);
    guideContext.fillStyle = isVertical ? "rgba(194, 245, 109, 0.3)" : "rgba(103, 211, 255, 0.3)";
    if (isVertical) {
      guideContext.fillRect(center - bandWidth / 2, 0, bandWidth, bounds.height);
    } else {
      guideContext.fillRect(0, center - bandWidth / 2, bounds.width, bandWidth);
    }

    guideContext.beginPath();
    guideContext.moveTo(isVertical ? center : 0, isVertical ? 0 : center);
    guideContext.lineTo(isVertical ? center : bounds.width, isVertical ? bounds.height : center);
    // A dark outline plus a bright core is visible on both light and dark images.
    guideContext.strokeStyle = "rgba(5, 8, 12, 0.95)";
    guideContext.lineWidth = 6;
    guideContext.stroke();
    guideContext.strokeStyle = color;
    guideContext.lineWidth = 3;
    guideContext.stroke();
    guideContext.fillStyle = color;
    if (isVertical) {
      guideContext.fillRect(center - 5, 0, 10, 6);
      guideContext.fillRect(center - 5, bounds.height - 6, 10, 6);
    } else {
      guideContext.fillRect(0, center - 5, 6, 10);
      guideContext.fillRect(bounds.width - 6, center - 5, 6, 10);
    }
  });
}

function renderWorkingImage() {
  if (!state.workingImageData) return;
  const { width, height } = state.workingImageData;
  elements.previewCanvas.width = width;
  elements.previewCanvas.height = height;
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

function imageLuminance(imageData) {
  const { width, height, data } = imageData;
  const luma = new Float32Array(width * height);
  for (let index = 0; index < luma.length; index += 1) {
    const pixel = index * 4;
    luma[index] = data[pixel + 3] < 16 ? NaN : luminance(data[pixel], data[pixel + 1], data[pixel + 2]);
  }
  return luma;
}

function detectLines(imageData, sensitivity, orientation, luma = imageLuminance(imageData)) {
  const { width, height } = imageData;
  const isVertical = orientation === "vertical";
  const axisLength = isVertical ? width : height;
  const crossLength = isVertical ? height : width;
  if (axisLength < 5 || crossLength < 12) return [];

  const amount = Math.max(10, Math.min(95, sensitivity)) / 100;
  const pixelThreshold = 3 + (1 - amount) * 28;
  const coverageThreshold = 0.15 + (1 - amount) * 0.4;
  const maxLineWidth = Math.max(8, Math.min(48, Math.round(axisLength * 0.012)));
  // Sample evenly along the line to bound work on large phone images.
  const sampleCount = Math.min(crossLength, 512);
  const sampleOffsets = Array.from({ length: sampleCount }, (_, sample) => {
    const cross = Math.round(sample * (crossLength - 1) / (sampleCount - 1));
    return isVertical ? cross * width : cross;
  });
  const stride = isVertical ? 1 : width;
  const candidates = new Uint8Array(axisLength);
  const radii = [1, 2, 4, 8, 16, 32, maxLineWidth].filter(
    (radius, index, values) => radius <= maxLineWidth && values.indexOf(radius) === index,
  );

  for (const radius of radii) {
    const responses = new Float32Array(axisLength);
    const coverage = new Float32Array(axisLength);
    for (let axis = 1; axis < axisLength - 1; axis += 1) {
      const centerOffset = axis * stride;
      const beforeOffset = Math.max(0, axis - radius) * stride;
      const afterOffset = Math.min(axisLength - 1, axis + radius) * stride;
      let total = 0;
      let lightHits = 0;
      let darkHits = 0;
      for (const crossOffset of sampleOffsets) {
        const value = luma[centerOffset + crossOffset];
        const before = value - luma[beforeOffset + crossOffset];
        const after = value - luma[afterOffset + crossOffset];
        // A stripe contrasts with BOTH sides. A lone object edge does not.
        // Multiple radii find the entire band, including wider stripe interiors.
        const contrast = before > 0 && after > 0 ? Math.min(before, after)
          : before < 0 && after < 0 ? Math.max(before, after) : 0;
        total += Math.abs(contrast);
        if (contrast >= pixelThreshold) lightHits += 1;
        if (contrast <= -pixelThreshold) darkHits += 1;
      }
      responses[axis] = total / sampleCount;
      coverage[axis] = Math.max(lightHits, darkHits) / sampleCount;
    }
    const values = Array.from(responses.slice(1, -1));
    const typicalResponse = median(values);
    const deviation = median(values.map((value) => Math.abs(value - typicalResponse)));
    const threshold = Math.max(
      pixelThreshold * coverageThreshold,
      typicalResponse + Math.max(1, deviation * 1.4826) * (3.2 - amount * 1.8),
    );
    for (let axis = 1; axis < axisLength - 1; axis += 1) {
      if (responses[axis] >= threshold && coverage[axis] >= coverageThreshold) candidates[axis] = 1;
    }
  }

  const lines = [];
  let start = -1;

  const finishLine = (end) => {
    if (start < 0) return;
    const widthOfLine = end - start + 1;
    if (widthOfLine <= maxLineWidth) {
      lines.push({ orientation, start, end, width: widthOfLine });
    }
    start = -1;
  };

  for (let axis = 1; axis < axisLength - 1; axis += 1) {
    if (candidates[axis]) {
      if (start < 0) start = axis;
    } else if (start >= 0) {
      finishLine(axis - 1);
    }
  }
  finishLine(axisLength - 2);

  return mergeNearbyLines(lines, axisLength, maxLineWidth);
}

function mergeNearbyLines(lines, axisLength, maxLineWidth) {
  if (lines.length < 2) return lines;
  const merged = [];
  const gapLimit = Math.max(2, Math.round(axisLength * 0.0015));

  lines.forEach((line) => {
    const previous = merged[merged.length - 1];
    if (previous && line.start - previous.end - 1 <= gapLimit && line.end - previous.start + 1 <= maxLineWidth) {
      previous.end = line.end;
      previous.width = previous.end - previous.start + 1;
    } else {
      merged.push({ ...line });
    }
  });

  return merged;
}

function runDetection({ announce = true } = {}) {
  if (!state.workingImageData) return;
  const sensitivity = Number(elements.sensitivity.value);
  const luma = imageLuminance(state.workingImageData);
  if (state.orientation === "both") {
    state.detections = [
      ...detectLines(state.workingImageData, sensitivity, "vertical", luma),
      ...detectLines(state.workingImageData, sensitivity, "horizontal", luma),
    ];
  } else {
    state.detections = detectLines(state.workingImageData, sensitivity, state.orientation, luma);
  }
  drawGuides();
  updateDetectionSummary();
  if (announce) {
    const mode = state.orientation === "both" ? "Both directions" : state.orientation;
    const message = state.detections.length
      ? `${mode}: ${state.detections.length} found`
      : `${mode}: none found`;
    setStatus(message.charAt(0).toUpperCase() + message.slice(1), state.detections.length ? "success" : "neutral");
  }
}

function interpolateDetectedLine(data, width, height, line) {
  const padding = Math.max(2, Math.min(12, Math.ceil(line.width * 0.8)));
  const isVertical = line.orientation === "vertical";

  if (isVertical) {
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
    return;
  }

  const top = Math.max(0, line.start - padding);
  const bottom = Math.min(height - 1, line.end + padding);

  for (let x = 0; x < width; x += 1) {
    const topPixel = (top * width + x) * 4;
    const bottomPixel = (bottom * width + x) * 4;
    for (let y = line.start; y <= line.end; y += 1) {
      const destination = (y * width + x) * 4;
      const proportion = bottom === top ? 0 : (y - top) / (bottom - top);
      data[destination] = Math.round(data[topPixel] * (1 - proportion) + data[bottomPixel] * proportion);
      data[destination + 1] = Math.round(data[topPixel + 1] * (1 - proportion) + data[bottomPixel + 1] * proportion);
      data[destination + 2] = Math.round(data[topPixel + 2] * (1 - proportion) + data[bottomPixel + 2] * proportion);
      data[destination + 3] = Math.round(data[topPixel + 3] * (1 - proportion) + data[bottomPixel + 3] * proportion);
    }
  }
}

function removeDetectedLines() {
  if (!state.workingImageData || !state.detections.length) return;

  state.history.push({
    imageData: cloneImageData(state.workingImageData),
    detections: state.detections.map((line) => ({ ...line })),
    orientation: state.orientation,
    sensitivity: elements.sensitivity.value,
  });

  const cleaned = cloneImageData(state.workingImageData);
  const { width, height, data } = cleaned;
  const removedCount = state.detections.length;
  const removedDescription = detectionDescription(state.detections);
  const removedOrientation = state.detections[0].orientation;

  state.detections.forEach((line) => {
    interpolateDetectedLine(data, width, height, line);
  });

  state.workingImageData = cleaned;
  state.detections = [];
  renderWorkingImage();
  runDetection({ announce: false });
  if (removedCount === 1) {
    setStatus(`Removed 1 ${removedOrientation} line`, "success");
  } else {
    setStatus(`Removed ${removedDescription} lines`, "success");
  }
}

function undoLastEdit() {
  const previous = state.history.pop();
  if (!previous) return;
  state.workingImageData = previous.imageData;
  state.detections = previous.detections;
  state.orientation = previous.orientation;
  elements.sensitivity.value = previous.sensitivity;
  elements.sensitivityValue.textContent = `${previous.sensitivity}%`;
  updateActionLabels();
  setGuidesVisible(true);
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

function setGuidesVisible(visible) {
  state.guidesVisible = visible;
  elements.toggleGuidesButton.textContent = state.guidesVisible ? "Hide guides" : "Show guides";
  elements.toggleGuidesButton.setAttribute("aria-pressed", String(state.guidesVisible));
  drawGuides();
  updateDetectionSummary();
}

function toggleGuides() {
  setGuidesVisible(!state.guidesVisible);
}

elements.chooseButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", (event) => {
  loadImageFile(event.target.files[0]);
  event.target.value = "";
});
elements.orientationInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) setOrientation(input.value);
  });
});
elements.legacyOrientationButtons.forEach((button) => {
  button.addEventListener("click", () => setOrientation(button.dataset.orientation));
});
elements.detectButton.addEventListener("click", () => {
  setGuidesVisible(true);
  runDetection();
});
elements.removeButton.addEventListener("click", removeDetectedLines);
elements.undoButton.addEventListener("click", undoLastEdit);
elements.resetButton.addEventListener("click", resetImage);
elements.downloadButton.addEventListener("click", downloadImage);
elements.toggleGuidesButton.addEventListener("click", toggleGuides);

elements.sensitivity.addEventListener("input", () => {
  elements.sensitivityValue.textContent = `${elements.sensitivity.value}%`;
  if (hasImage()) runDetection({ announce: false });
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

if (typeof ResizeObserver !== "undefined") {
  const guideResizeObserver = new ResizeObserver(drawGuides);
  guideResizeObserver.observe(elements.previewCanvas);
}
window.addEventListener("resize", drawGuides);

updateActionLabels();
elements.sensitivityValue.textContent = `${elements.sensitivity.value}%`;
updateDetectionSummary();
