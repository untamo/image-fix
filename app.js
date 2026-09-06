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
  previewRepair: false,
  repairedRows: [],
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
  focusNavigation: document.querySelector("#focusNavigation"),
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
  previewRepairButton: document.querySelector("#previewRepairButton"),
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
const repairCanvas = document.createElement("canvas");
const repairContext = repairCanvas.getContext("2d");

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
  elements.previewRepairButton.disabled = !loaded || state.selectedLineIndex < 0;
  elements.previewRepairButton.textContent = state.previewRepair ? "Show original row" : "Preview fix";
  elements.previewRepairButton.setAttribute("aria-pressed", String(state.previewRepair));
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
    elements.lineCoverage.textContent = `${count} candidate pixel row${count === 1 ? "" : "s"}. Fix changes only the selected row.`;
    elements.guideSummary.textContent = state.previewRepair ? "Previewing the fix on one pixel row. Apply with Fix selected row." : "Fisheye: one selected pixel row, with the surrounding image rows enlarged.";
    elements.selectedLineStatus.textContent = `Row ${state.detections[state.selectedLineIndex].start + 1} · 1 px`;
    setDetectionStatus("Review", "success");
  }

  updateControls();
}

// A one-dimensional fisheye centered on one source pixel row. Its profile
// depends only on distance from that row, never on neighboring detections.
function buildFocusLayout(width, height, viewWidth, viewHeight, lines, selectedIndex, focusY = viewHeight / 2) {
  const scale = Math.min(viewWidth / width, viewHeight / height, 1);
  const segments = [];
  let sourceY = 0;
  let displayY = 0;
  function append(end, pixelsPerRow, factor = 1) {
    if (end <= sourceY) return;
    const displayHeight = (end - sourceY) * pixelsPerRow;
    segments.push({ start: sourceY, end, top: displayY, bottom: displayY + displayHeight, factor, pixelsPerRow });
    sourceY = end;
    displayY += displayHeight;
  }
  const selected = lines[selectedIndex];
  if (selected) {
    const row = selected.start;
    const first = Math.max(0, row - 4);
    const last = Math.min(height - 1, row + 4);
    append(first, scale);
    for (let y = first; y <= last; y += 1) {
      const factor = 2 * (5 - Math.abs(y - row));
      // The lens uses native-size pixels even if the overview is downscaled,
      // so the selected one-pixel row remains ten CSS pixels high on phones.
      append(y + 1, factor, factor);
    }
  }
  append(height, scale);
  const layout = { segments, scale, width: width * scale, viewWidth, viewHeight, offset: 0 };
  layout.offset = selected
    ? focusY - mappedY(layout, selected.start + 0.5)
    : (viewHeight - displayY) / 2;
  return layout;
}

function mappedY(layout, sourceY) {
  const segment = layout.segments.find((part) => sourceY <= part.end) || layout.segments.at(-1);
  return segment.top + (sourceY - segment.start) * segment.pixelsPerRow + layout.offset;
}

function focusBounds(layout, line, imageHeight) {
  return {
    left: (layout.viewWidth - layout.width) / 2,
    top: mappedY(layout, Math.max(0, line.start - 4)),
    bottom: mappedY(layout, Math.min(imageHeight, line.start + 5)),
    width: layout.width,
  };
}

function drawGuides() {
  const layout = state.previewLayout;
  if (!layout) return;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  elements.guideCanvas.width = elements.previewCanvas.width;
  elements.guideCanvas.height = elements.previewCanvas.height;
  guideContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  guideContext.clearRect(0, 0, layout.viewWidth, layout.viewHeight);
  const selected = state.detections[state.selectedLineIndex];
  elements.focusNavigation.classList.toggle("hidden", !selected);
  if (!selected) return;
  const lens = focusBounds(layout, selected, state.workingImageData.height);
  // Only the perimeter of the entire lens is marked. No image row is tinted,
  // outlined, or crossed by a guide inside the area being inspected.
  guideContext.strokeStyle = "#c2f56d";
  guideContext.lineWidth = 1;
  guideContext.strokeRect(lens.left + 0.5, lens.top - 0.5,
    Math.max(0, lens.width - 1), lens.bottom - lens.top + 1);
  elements.previousLineButton.style.top = `${lens.top - 50}px`;
  elements.nextLineButton.style.top = `${lens.bottom + 6}px`;
  const center = lens.left + lens.width / 2;
  elements.previousLineButton.style.left = `${center}px`;
  elements.nextLineButton.style.left = `${center}px`;
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
    const sourceTop = part.start + (top - part.top - layout.offset) / part.pixelsPerRow;
    const sourceHeight = (bottom - top) / part.pixelsPerRow;
    previewContext.drawImage(imageCanvas, 0, sourceTop, width, sourceHeight,
      left, top, layout.width, bottom - top);
  }
  if (state.previewRepair && state.selectedLineIndex >= 0) {
    const line = state.detections[state.selectedLineIndex];
    const strip = repairedRowImage(state.workingImageData, line);
    repairCanvas.width = width;
    repairCanvas.height = 1;
    repairContext.putImageData(strip, 0, 0);
    const top = mappedY(layout, line.start);
    const bottom = mappedY(layout, line.start + 1);
    // Clear first: transparent repair pixels must replace, not blend over, the original.
    previewContext.clearRect(left, top, layout.width, bottom - top);
    previewContext.drawImage(repairCanvas, 0, 0, width, 1, left, top, layout.width, bottom - top);
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
  const repaired = new Set(state.repairedRows);
  state.detections = detectLines(state.workingImageData, sensitivity).flatMap((band) =>
    Array.from({ length: band.width }, (_, offset) => ({
      start: band.start + offset, end: band.start + offset, width: 1,
      bandStart: band.start, bandEnd: band.end,
    })).filter((line) => !repaired.has(line.start)));

  state.selectedLineIndex = state.detections.length ? 0 : -1;
  // Keep the closest line selected as sensitivity or image pixels change.
  state.detections.forEach((line, index) => {
    const selected = state.detections[state.selectedLineIndex];
    if (Math.abs(line.start + line.width / 2 - anchor) < Math.abs(selected.start + selected.width / 2 - anchor)) {
      state.selectedLineIndex = index;
    }
  });
  if (!state.detections.length) state.previewRepair = false;
  renderPreview();
  updateDetectionSummary();
  if (announce) {
    setStatus(state.detections.length ? `Horizontal: ${state.detections.length} found` : "Horizontal: none found",
      state.detections.length ? "success" : "neutral");
  }
}

function repairedRowImage(imageData, line) {
  const { width, height, data } = imageData;
  const row = line.start;
  // Sample outside the detected stripe, but write only the selected pixel row.
  const top = Math.max(0, (line.bandStart ?? row) - 1);
  const bottom = Math.min(height - 1, (line.bandEnd ?? row) + 1);
  const proportion = bottom === top ? 0 : (row - top) / (bottom - top);
  const strip = new ImageData(width, 1);
  for (let x = 0; x < width; x += 1) {
    for (let channel = 0; channel < 4; channel += 1) {
      strip.data[x * 4 + channel] = Math.round(
        data[(top * width + x) * 4 + channel] * (1 - proportion)
        + data[(bottom * width + x) * 4 + channel] * proportion);
    }
  }
  return strip;
}

function fixSelectedRow() {
  const line = state.detections[state.selectedLineIndex];
  if (!state.workingImageData || !line) return;
  state.history.push({
    imageData: cloneImageData(state.workingImageData),
    detections: state.detections.map((candidate) => ({ ...candidate })),
    selectedLineIndex: state.selectedLineIndex,
    repairedRows: state.repairedRows.slice(),
    sensitivity: elements.sensitivity.value,
  });
  const strip = repairedRowImage(state.workingImageData, line);
  const cleaned = cloneImageData(state.workingImageData);
  cleaned.data.set(strip.data, line.start * cleaned.width * 4);
  state.workingImageData = cleaned;
  state.repairedRows.push(line.start);
  state.previewRepair = false;
  renderWorkingImage();
  runDetection({ announce: false });
  setStatus(`Fixed row ${line.start + 1} · 1 pixel high`, "success");
}

function toggleRepairPreview() {
  if (!state.detections.length) return;
  state.previewRepair = !state.previewRepair;
  renderPreview();
  updateDetectionSummary();
}

function undoLastEdit() {
  const previous = state.history.pop();
  if (!previous) return;
  state.workingImageData = previous.imageData;
  state.detections = previous.detections;
  state.selectedLineIndex = previous.selectedLineIndex;
  state.repairedRows = previous.repairedRows;
  state.previewRepair = false;
  elements.sensitivity.value = previous.sensitivity;
  elements.sensitivityValue.textContent = `${previous.sensitivity}%`;
  renderWorkingImage();
  updateDetectionSummary();
  setStatus("Last edit undone", "success");
}

function resetImage() {
  if (!state.sourceImageData) return;
  state.history = [];
  state.repairedRows = [];
  state.previewRepair = false;
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
    state.repairedRows = [];
    state.previewRepair = false;
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
elements.previewRepairButton.addEventListener("click", toggleRepairPreview);
elements.removeButton.addEventListener("click", fixSelectedRow);
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
