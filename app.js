const MAX_PIXELS = 12000000;
const MAX_DIMENSION = 2600;

const state = {
  sourceImageData: null,
  workingImageData: null,
  detections: [],
  history: [],
  fileBaseName: "cleaned-image",
  selectedLineIndex: -1,
  previewLayout: null,
  controlsVisible: true,
  controlsPosition: "bottom",
};

const elements = {
  fileInput: document.querySelector("#fileInput"),
  chooseButton: document.querySelector("#chooseButton"),
  dropzone: document.querySelector("#dropzone"),
  canvasArea: document.querySelector("#canvasArea"),
  canvasStage: document.querySelector("#canvasStage"),
  editorToolbar: document.querySelector("#editorToolbar"),
  previousLineButton: document.querySelector("#previousLineButton"),
  nextLineButton: document.querySelector("#nextLineButton"),
  selectedLineStatus: document.querySelector("#selectedLineStatus"),
  editorShell: document.querySelector("#editorShell"),
  controlsPanel: document.querySelector("#controlsPanel"),
  toggleControlsButton: document.querySelector("#toggleControlsButton"),
  moveControlsButton: document.querySelector("#moveControlsButton"),
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
  detectButtonLabel: document.querySelector("#detectButtonLabel"),
  removeButton: document.querySelector("#removeButton"),
  removeButtonLabel: document.querySelector("#removeButtonLabel"),
  undoButton: document.querySelector("#undoButton"),
  resetButton: document.querySelector("#resetButton"),
  downloadButton: document.querySelector("#downloadButton"),
};

const previewContext = elements.previewCanvas.getContext("2d", { willReadFrequently: true });
const guideContext = elements.guideCanvas.getContext("2d");
// Keep original-resolution pixels separate from the magnified display.
const imageCanvas = document.createElement("canvas");
const imageContext = imageCanvas.getContext("2d", { willReadFrequently: true });

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
  elements.editorShell.classList.toggle("is-editing", loaded);
  elements.detectButton.disabled = !loaded;
  elements.removeButton.disabled = !loaded || state.detections.length === 0;
  elements.undoButton.disabled = !loaded || state.history.length === 0;
  elements.resetButton.disabled = !loaded;
  elements.downloadButton.disabled = !loaded;
  elements.previousLineButton.disabled = state.detections.length < 2;
  elements.nextLineButton.disabled = state.detections.length < 2;
}

function updateDetectionSummary() {
  const count = state.detections.length;
  elements.lineCount.textContent = String(count);

  if (!hasImage()) {
    elements.lineCoverage.textContent = "Upload an image to begin detection.";
    elements.guideSummary.textContent = "Detected lines will appear as guides";
    elements.selectedLineStatus.textContent = "No lines detected";
    setDetectionStatus("Waiting");
    updateControls();
    return;
  }

  if (count === 0) {
    elements.lineCoverage.textContent = "No horizontal lines found at this sensitivity.";
    elements.guideSummary.textContent = "No horizontal lines detected";
    elements.selectedLineStatus.textContent = "No lines detected";
    setDetectionStatus("None found");
  } else {
    elements.lineCoverage.textContent = `${count} horizontal line${count === 1 ? "" : "s"} highlighted. Review before removing.`;
    elements.guideSummary.textContent = "Selected line: 5×. Nearby lines taper to normal size.";
    elements.selectedLineStatus.textContent = `Line ${state.selectedLineIndex + 1} / ${count} · 5×`;
    setDetectionStatus("Review", "success");
  }

  updateControls();
}

// Build a continuous piecewise mapping: real image bands grow vertically,
// while untouched gaps stay at the normal fit-to-workspace scale.
function buildFocusLayout(width, height, viewWidth, viewHeight, lines, selectedIndex, focusY = viewHeight / 2) {
  const scale = Math.min(viewWidth / width, viewHeight / height, 1);
  const segments = [];
  let sourceY = 0;
  let displayY = 0;
  function append(end, factor) {
    if (end <= sourceY) return;
    const displayHeight = (end - sourceY) * scale * factor;
    segments.push({ start: sourceY, end, top: displayY, bottom: displayY + displayHeight, factor });
    sourceY = end;
    displayY += displayHeight;
  }
  lines.forEach((line, index) => {
    const factor = Math.max(1, 5 - Math.abs(index - selectedIndex));
    if (factor === 1 || selectedIndex < 0) return;
    // Include eight display pixels of context on each side, bounded by
    // neighboring midpoints so even tightly spaced bands cannot overlap.
    const previous = lines[index - 1];
    const next = lines[index + 1];
    const start = Math.max(0, line.start - 8 / scale,
      previous ? (previous.end + 1 + line.start) / 2 : 0);
    const end = Math.min(height, line.end + 1 + 8 / scale,
      next ? (line.end + 1 + next.start) / 2 : height);
    append(start, 1);
    append(end, factor);
  });
  append(height, 1);
  const layout = { segments, scale, width: width * scale, viewWidth, viewHeight, offset: 0 };
  const selected = lines[selectedIndex];
  layout.offset = selected
    ? focusY - mappedY(layout, selected.start + selected.width / 2)
    : (viewHeight - displayY) / 2;
  return layout;
}

function mappedY(layout, sourceY) {
  const segment = layout.segments.find((part) => sourceY <= part.end) || layout.segments.at(-1);
  return segment.top + (sourceY - segment.start) * layout.scale * segment.factor + layout.offset;
}

function drawGuides() {
  const layout = state.previewLayout;
  if (!layout) return;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  elements.guideCanvas.width = elements.previewCanvas.width;
  elements.guideCanvas.height = elements.previewCanvas.height;
  guideContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  guideContext.clearRect(0, 0, layout.viewWidth, layout.viewHeight);
  const left = (layout.viewWidth - layout.width) / 2;
  state.detections.forEach((line, index) => {
    const center = mappedY(layout, line.start + line.width / 2);
    if (center < 0 || center > layout.viewHeight) return;
    const selected = index === state.selectedLineIndex;
    const color = selected ? "#c2f56d" : "#67d3ff";
    const bandHeight = mappedY(layout, line.end + 1) - mappedY(layout, line.start);
    guideContext.fillStyle = selected ? "rgba(194, 245, 109, 0.18)" : "rgba(103, 211, 255, 0.12)";
    guideContext.fillRect(left, center - bandHeight / 2, layout.width, bandHeight);
    // Outline the band rather than covering the pixels being inspected.
    for (const edge of [center - bandHeight / 2, center + bandHeight / 2]) {
      guideContext.beginPath();
      guideContext.moveTo(left, edge);
      guideContext.lineTo(left + layout.width, edge);
      guideContext.strokeStyle = "rgba(5, 8, 12, 0.95)";
      guideContext.lineWidth = selected ? 3 : 2;
      guideContext.stroke();
      guideContext.strokeStyle = color;
      guideContext.lineWidth = 1;
      guideContext.stroke();
    }
    guideContext.fillStyle = color;
    guideContext.fillRect(left, center - 5, 6, 10);
    guideContext.fillRect(left + layout.width - 6, center - 5, 6, 10);
  });
}

function renderPreview() {
  if (!state.workingImageData) return;
  const bounds = elements.canvasStage.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  // Center the selected line in the space left clear by the floating controls.
  const toolbar = elements.editorToolbar.getBoundingClientRect();
  let clearTop = Math.max(0, toolbar.bottom - bounds.top + 8);
  let clearBottom = bounds.height;
  if (state.controlsVisible) {
    const panel = elements.controlsPanel.getBoundingClientRect();
    if (state.controlsPosition === "bottom") clearBottom = panel.top - bounds.top - 8;
    else clearTop = Math.max(clearTop, panel.bottom - bounds.top + 8);
  }
  const focusY = clearBottom > clearTop ? (clearTop + clearBottom) / 2 : bounds.height / 2;
  const { width, height } = state.workingImageData;
  const layout = buildFocusLayout(width, height, bounds.width, bounds.height,
    state.detections, state.selectedLineIndex, focusY);
  state.previewLayout = layout;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  elements.previewCanvas.width = Math.round(bounds.width * pixelRatio);
  elements.previewCanvas.height = Math.round(bounds.height * pixelRatio);
  previewContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  previewContext.clearRect(0, 0, bounds.width, bounds.height);
  previewContext.imageSmoothingEnabled = false;
  const left = (bounds.width - layout.width) / 2;
  for (const part of layout.segments) {
    const top = Math.max(0, part.top + layout.offset);
    const bottom = Math.min(bounds.height, part.bottom + layout.offset);
    if (bottom <= top) continue;
    const sourceTop = part.start + (top - part.top - layout.offset) / (layout.scale * part.factor);
    const sourceHeight = (bottom - top) / (layout.scale * part.factor);
    previewContext.drawImage(imageCanvas, 0, sourceTop, width, sourceHeight,
      left, top, layout.width, bottom - top);
  }
  drawGuides();
}

function renderWorkingImage() {
  if (!state.workingImageData) return;
  const { width, height } = state.workingImageData;
  imageCanvas.width = width;
  imageCanvas.height = height;
  imageContext.putImageData(state.workingImageData, 0, 0);
  renderPreview();
}

function cycleSelectedLine(direction) {
  const count = state.detections.length;
  if (!count) return;
  state.selectedLineIndex = (state.selectedLineIndex + direction + count) % count;
  renderPreview();
  updateDetectionSummary();
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

function detectLines(imageData, sensitivity, luma = imageLuminance(imageData)) {
  const { width, height } = imageData;
  const axisLength = height;
  const crossLength = width;
  if (axisLength < 5 || crossLength < 12) return [];

  const amount = Math.max(10, Math.min(95, sensitivity)) / 100;
  const pixelThreshold = 3 + (1 - amount) * 28;
  const coverageThreshold = 0.15 + (1 - amount) * 0.4;
  const maxLineWidth = Math.max(8, Math.min(48, Math.round(axisLength * 0.012)));
  // Sample evenly along the line to bound work on large phone images.
  const sampleCount = Math.min(crossLength, 512);
  const sampleOffsets = Array.from({ length: sampleCount }, (_, sample) => {
    const cross = Math.round(sample * (crossLength - 1) / (sampleCount - 1));
    return cross;
  });
  const stride = width;
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
      lines.push({ start, end, width: widthOfLine });
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
  const previous = state.detections[state.selectedLineIndex];
  const anchor = previous ? previous.start + previous.width / 2 : 0;
  state.detections = detectLines(state.workingImageData, sensitivity);
  state.selectedLineIndex = state.detections.length ? 0 : -1;
  // Keep the closest line selected as sensitivity or image pixels change.
  state.detections.forEach((line, index) => {
    const selected = state.detections[state.selectedLineIndex];
    if (Math.abs(line.start + line.width / 2 - anchor) < Math.abs(selected.start + selected.width / 2 - anchor)) {
      state.selectedLineIndex = index;
    }
  });
  renderPreview();
  updateDetectionSummary();
  if (announce) {
    setStatus(state.detections.length ? `Horizontal: ${state.detections.length} found` : "Horizontal: none found",
      state.detections.length ? "success" : "neutral");
  }
}

function interpolateDetectedLine(data, width, height, line) {
  const padding = Math.max(2, Math.min(12, Math.ceil(line.width * 0.8)));
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
    selectedLineIndex: state.selectedLineIndex,
    sensitivity: elements.sensitivity.value,
  });

  const cleaned = cloneImageData(state.workingImageData);
  const { width, height, data } = cleaned;
  const removedCount = state.detections.length;

  state.detections.forEach((line) => {
    interpolateDetectedLine(data, width, height, line);
  });

  state.workingImageData = cleaned;
  renderWorkingImage();
  runDetection({ announce: false });
  setStatus(`Removed ${removedCount} horizontal line${removedCount === 1 ? "" : "s"}`, "success");
}

function undoLastEdit() {
  const previous = state.history.pop();
  if (!previous) return;
  state.workingImageData = previous.imageData;
  state.detections = previous.detections;
  state.selectedLineIndex = previous.selectedLineIndex;
  elements.sensitivity.value = previous.sensitivity;
  elements.sensitivityValue.textContent = `${previous.sensitivity}%`;
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

    imageCanvas.width = width;
    imageCanvas.height = height;
    imageContext.clearRect(0, 0, width, height);
    imageContext.drawImage(image, 0, 0, width, height);

    state.sourceImageData = imageContext.getImageData(0, 0, width, height);
    state.workingImageData = cloneImageData(state.sourceImageData);
    state.history = [];
    state.detections = [];
    state.selectedLineIndex = -1;
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

function toggleControls() {
  state.controlsVisible = !state.controlsVisible;
  elements.controlsPanel.classList.toggle("hidden", !state.controlsVisible);
  elements.toggleControlsButton.setAttribute("aria-expanded", String(state.controlsVisible));
  elements.toggleControlsButton.textContent = state.controlsVisible ? "Hide controls" : "Show controls";
  elements.moveControlsButton.disabled = !state.controlsVisible;
  renderPreview();
}

function moveControls() {
  state.controlsPosition = state.controlsPosition === "bottom" ? "top" : "bottom";
  elements.controlsPanel.dataset.position = state.controlsPosition;
  elements.moveControlsButton.textContent = state.controlsPosition === "bottom"
    ? "Move controls to top" : "Move controls to bottom";
  renderPreview();
}

elements.toggleControlsButton.addEventListener("click", toggleControls);
elements.moveControlsButton.addEventListener("click", moveControls);

elements.chooseButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", (event) => {
  loadImageFile(event.target.files[0]);
  event.target.value = "";
});
elements.previousLineButton.addEventListener("click", () => cycleSelectedLine(-1));
elements.nextLineButton.addEventListener("click", () => cycleSelectedLine(1));
elements.detectButton.addEventListener("click", () => runDetection());
elements.removeButton.addEventListener("click", removeDetectedLines);
elements.undoButton.addEventListener("click", undoLastEdit);
elements.resetButton.addEventListener("click", resetImage);
elements.downloadButton.addEventListener("click", downloadImage);

elements.sensitivity.addEventListener("input", () => {
  elements.sensitivityValue.textContent = `${elements.sensitivity.value}%`;
  if (hasImage()) {
    runDetection({ announce: false });
  }
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
  const guideResizeObserver = new ResizeObserver(renderPreview);
  guideResizeObserver.observe(elements.canvasStage);
  guideResizeObserver.observe(elements.controlsPanel);
  guideResizeObserver.observe(elements.editorToolbar);
}
window.addEventListener("resize", renderPreview);

elements.sensitivityValue.textContent = `${elements.sensitivity.value}%`;
updateDetectionSummary();
