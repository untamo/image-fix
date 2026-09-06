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
  repairPlan: null,
  repairedRows: [],
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
  previewCanvas: document.querySelector("#previewCanvas"),
  guideCanvas: document.querySelector("#guideCanvas"),
  statusText: document.querySelector("#statusText"),
  guideSummary: document.querySelector("#guideSummary"),
  errorNotice: document.querySelector("#errorNotice"),
  sensitivity: document.querySelector("#sensitivity"),
  sensitivityValue: document.querySelector("#sensitivityValue"),
  previewRepairButton: document.querySelector("#previewRepairButton"),
  removeButton: document.querySelector("#removeButton"),
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

function setStatus(message) {
  elements.statusText.textContent = message;
}

function setError(message = "") {
  elements.errorNotice.textContent = message;
  elements.errorNotice.classList.toggle("hidden", !message);
  if (message) {
    setStatus("Something went wrong", "error");
  }
}

function hasImage() {
  return Boolean(state.workingImageData);
}

function updateControls() {
  const loaded = hasImage();
  elements.editorShell.classList.toggle("is-editing", loaded);
  elements.previewRepairButton.disabled = !loaded || state.selectedLineIndex < 0;
  elements.previewRepairButton.setAttribute("title", state.previewRepair ? "Preview: showing repair — click to show original" : "Preview repair");
  elements.previewRepairButton.setAttribute("aria-pressed", String(state.previewRepair));
  elements.removeButton.disabled = !loaded || state.detections.length === 0;
  elements.downloadButton.disabled = !loaded;
  elements.previousLineButton.disabled = !loaded || state.selectedLineIndex <= 0;
  elements.nextLineButton.disabled = !loaded || state.selectedLineIndex < 0
    || state.selectedLineIndex >= state.detections.length - 1;
}

function updateDetectionSummary() {
  const count = state.detections.length;

  if (!hasImage()) {
    elements.guideSummary.textContent = "Detected lines will appear as guides";
    elements.selectedLineStatus.textContent = "No lines detected";

    updateControls();
    return;
  }

  if (count === 0) {
    elements.guideSummary.textContent = "No horizontal lines detected";
    elements.selectedLineStatus.textContent = "No lines detected";
  } else {
    const plan = getRepairPlan();
    elements.guideSummary.textContent = `${state.previewRepair ? "Previewing" : "Repair covers"} rows ${plan.start + 1}–${plan.end + 1}, including color bleed. Selection stays 1 pixel high.`;
    elements.selectedLineStatus.textContent = `Row ${state.detections[state.selectedLineIndex].start + 1} · 1 px`;
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

// Remove unused canvas space while keeping the focus arrows within the image area.
function fitPreviewLayout(width, height, viewWidth, maxHeight, lines, selectedIndex) {
  const layout = buildFocusLayout(width, height, viewWidth, maxHeight, lines, selectedIndex);
  const selected = lines[selectedIndex];
  const lens = selected ? focusBounds(layout, selected, height) : null;
  let top = Math.max(0, Math.min(mappedY(layout, 0), lens ? lens.top - 50 : Infinity));
  const bottom = Math.min(maxHeight, Math.max(mappedY(layout, height), lens ? lens.bottom + 50 : 0));
  // Keep the three action buttons reachable even for very shallow images.
  top = Math.min(top, bottom - 196);
  layout.offset -= top;
  layout.viewHeight = Math.max(1, bottom - top);
  return layout;
}

function renderPreview() {
  if (!state.workingImageData) return;
  const bounds = elements.canvasStage.getBoundingClientRect();
  if (!bounds.width) return;
  // Derive available height from the window, never the previously trimmed stage.
  // This keeps resizing and selection changes free of layout feedback loops.
  const controlHeight = elements.controlsPanel.getBoundingClientRect().height;
  const maxHeight = Math.max(200, window.innerHeight - controlHeight - 18);
  const { width, height } = state.workingImageData;
  const layout = fitPreviewLayout(width, height, bounds.width, maxHeight,
    state.detections, state.selectedLineIndex);
  elements.canvasStage.parentElement.style.height = `${layout.viewHeight}px`;
  state.previewLayout = layout;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  elements.previewCanvas.width = Math.round(bounds.width * pixelRatio);
  elements.previewCanvas.height = Math.round(layout.viewHeight * pixelRatio);
  previewContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  previewContext.clearRect(0, 0, bounds.width, layout.viewHeight);
  previewContext.imageSmoothingEnabled = false;
  const left = (bounds.width - layout.width) / 2;
  for (const part of layout.segments) {
    const top = Math.max(0, part.top + layout.offset);
    const bottom = Math.min(layout.viewHeight, part.bottom + layout.offset);
    if (bottom <= top) continue;
    const sourceTop = part.start + (top - part.top - layout.offset) / part.pixelsPerRow;
    const sourceHeight = (bottom - top) / part.pixelsPerRow;
    previewContext.drawImage(imageCanvas, 0, sourceTop, width, sourceHeight,
      left, top, layout.width, bottom - top);
  }
  if (state.previewRepair && state.selectedLineIndex >= 0) {
    const plan = getRepairPlan();
    repairCanvas.width = width;
    repairCanvas.height = plan.pixels.height;
    repairContext.putImageData(plan.pixels, 0, 0);
    // Draw each source row through the same fisheye as the original image.
    for (let row = plan.start; row <= plan.end; row += 1) {
      const top = mappedY(layout, row);
      const bottom = mappedY(layout, row + 1);
      previewContext.clearRect(left, top, layout.width, bottom - top);
      previewContext.drawImage(repairCanvas, 0, row - plan.start, width, 1,
        left, top, layout.width, bottom - top);
    }
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
  const next = state.selectedLineIndex + direction;
  if (next < 0 || next >= count) return;
  state.selectedLineIndex = next;
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

// Chroma-only artifacts can be nearly invisible to a luminance detector.
function detectColorRows(imageData, sensitivity) {
  const { width, height, data } = imageData;
  const candidates = new Uint8Array(height);
  const amount = Math.max(10, Math.min(95, sensitivity)) / 100;
  const threshold = 2 + (1 - amount) * 18;
  const coverage = 0.1 + (1 - amount) * 0.35;
  const samples = Math.min(width, 128);
  if (samples < 12) return candidates;
  for (const radius of [1, 2, 4, 8]) {
    for (let y = 1; y < height - 1; y += 1) {
      if (candidates[y]) continue;
      for (const channel of [0, 2]) {
        let positive = 0;
        let negative = 0;
        for (let sample = 0; sample < samples; sample += 1) {
          const x = Math.round(sample * (width - 1) / (samples - 1));
          const center = (y * width + x) * 4;
          const top = (Math.max(0, y - radius) * width + x) * 4;
          const bottom = (Math.min(height - 1, y + radius) * width + x) * 4;
          if (Math.min(data[center + 3], data[top + 3], data[bottom + 3]) < 16) continue;
          const value = data[center + channel] - data[center + 1];
          const before = value - (data[top + channel] - data[top + 1]);
          const after = value - (data[bottom + channel] - data[bottom + 1]);
          if (before >= threshold && after >= threshold) positive += 1;
          if (before <= -threshold && after <= -threshold) negative += 1;
        }
        if (Math.max(positive, negative) / samples >= coverage) candidates[y] = 1;
      }
    }
  }
  return candidates;
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
  const candidates = detectColorRows(imageData, sensitivity);
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

function selectStripeRow(imageData, band, repaired = new Set()) {
  const { width, height, data } = imageData;
  const top = Math.max(0, band.start - 1);
  const bottom = Math.min(height - 1, band.end + 1);
  const center = (band.start + band.end) / 2;
  const samples = Math.min(width, 64);
  let selected = null;
  let bestScore = -1;
  // Each detected stripe gets one one-pixel focus row: its strongest defect.
  // Equally strong rows resolve toward the stripe's center.
  for (let row = band.start; row <= band.end; row += 1) {
    if (repaired.has(row)) continue;
    const t = (row - top) / Math.max(1, bottom - top);
    let score = 0;
    for (let sample = 0; sample < samples; sample += 1) {
      const x = Math.round(sample * (width - 1) / Math.max(1, samples - 1));
      if (Math.min(data[(row * width + x) * 4 + 3], data[(top * width + x) * 4 + 3], data[(bottom * width + x) * 4 + 3]) < 16) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        const expected = data[(top * width + x) * 4 + channel] * (1 - t)
          + data[(bottom * width + x) * 4 + channel] * t;
        score += Math.abs(data[(row * width + x) * 4 + channel] - expected);
      }
    }
    if (score > bestScore || (score === bestScore && Math.abs(row - center) < Math.abs(selected - center))) {
      selected = row;
      bestScore = score;
    }
  }
  return selected === null ? null : {
    start: selected, end: selected, width: 1, bandStart: band.start, bandEnd: band.end,
  };
}

function runDetection({ announce = true } = {}) {
  if (!state.workingImageData) return;
  const sensitivity = Number(elements.sensitivity.value);
  const previous = state.detections[state.selectedLineIndex];
  const anchor = previous ? previous.start + previous.width / 2 : 0;
  const repaired = new Set(state.repairedRows);
  state.detections = detectLines(state.workingImageData, sensitivity)
    .map((band) => selectStripeRow(state.workingImageData, band, repaired))
    .filter(Boolean);

  state.selectedLineIndex = state.detections.length ? 0 : -1;
  // Keep the closest line selected as sensitivity or image pixels change.
  state.detections.forEach((line, index) => {
    const selected = state.detections[state.selectedLineIndex];
    if (Math.abs(line.start + line.width / 2 - anchor) < Math.abs(selected.start + selected.width / 2 - anchor)) {
      state.selectedLineIndex = index;
    }
  });
  if (!state.detections.length) {
    state.previewRepair = false;
    state.repairPlan = null;
  }
  renderPreview();
  updateDetectionSummary();
  if (announce) {
    setStatus(state.detections.length ? "Ready to inspect" : "No horizontal lines detected",
      state.detections.length ? "success" : "neutral");
  }
}

function repairBounds(imageData, line) {
  const { width, height, data } = imageData;
  let start = line.bandStart ?? line.start;
  let end = line.bandEnd ?? line.start;
  const referenceTop = Math.max(0, start - 7);
  const referenceBottom = Math.min(height - 1, end + 7);
  const samples = Math.min(width, 256);
  const stableColumns = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const x = Math.round(sample * (width - 1) / Math.max(1, samples - 1));
    const top = (referenceTop * width + x) * 4;
    const bottom = (referenceBottom * width + x) * 4;
    if (Math.min(data[top + 3], data[bottom + 3]) < 16) continue;
    if ([0, 1, 2].every((channel) => Math.abs(data[top + channel] - data[bottom + channel]) < 32)) stableColumns.push(x);
  }
  function hasColorBleed(row) {
    if (stableColumns.length < Math.max(8, samples * 0.1)) return false;
    const t = (row - referenceTop) / Math.max(1, referenceBottom - referenceTop);
    return [0, 1, 2].some((channel) => {
      const residuals = stableColumns.map((x) => {
        const expected = data[(referenceTop * width + x) * 4 + channel] * (1 - t)
          + data[(referenceBottom * width + x) * 4 + channel] * t;
        return data[(row * width + x) * 4 + channel] - expected;
      });
      return Math.abs(median(residuals)) > 2.5;
    });
  }
  while (start > referenceTop + 1 && hasColorBleed(start - 1)) start -= 1;
  while (end < referenceBottom - 1 && hasColorBleed(end + 1)) end += 1;
  return { start, end };
}

function planLineRepair(imageData, line) {
  const { width, height, data } = imageData;
  const { start, end } = repairBounds(imageData, line);
  const top = Math.max(0, start - 1);
  const bottom = Math.min(height - 1, end + 1);
  const pixels = new ImageData(width, end - start + 1);
  for (let row = start; row <= end; row += 1) {
    const t = bottom === top ? 0 : (row - top) / (bottom - top);
    for (let x = 0; x < width; x += 1) {
      for (let channel = 0; channel < 4; channel += 1) {
        pixels.data[((row - start) * width + x) * 4 + channel] = Math.round(
          data[(top * width + x) * 4 + channel] * (1 - t)
          + data[(bottom * width + x) * 4 + channel] * t);
      }
    }
  }
  return { start, end, pixels };
}

function getRepairPlan() {
  const line = state.detections[state.selectedLineIndex];
  const cached = state.repairPlan;
  if (cached && cached.source === state.workingImageData && cached.line === line) return cached;
  state.repairPlan = { ...planLineRepair(state.workingImageData, line), source: state.workingImageData, line };
  return state.repairPlan;
}

function fixSelectedLine() {
  const line = state.detections[state.selectedLineIndex];
  if (!state.workingImageData || !line) return;
  state.history.push({
    imageData: cloneImageData(state.workingImageData),
    detections: state.detections.map((candidate) => ({ ...candidate })),
    selectedLineIndex: state.selectedLineIndex,
    repairedRows: state.repairedRows.slice(),
    sensitivity: elements.sensitivity.value,
  });
  const plan = getRepairPlan();
  const cleaned = cloneImageData(state.workingImageData);
  cleaned.data.set(plan.pixels.data, plan.start * cleaned.width * 4);
  state.workingImageData = cleaned;
  for (let row = plan.start; row <= plan.end; row += 1) state.repairedRows.push(row);
  state.previewRepair = false;
  renderWorkingImage();
  runDetection({ announce: false });
  setStatus(`Fixed line and color bleed · rows ${plan.start + 1}–${plan.end + 1}`, "success");
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

elements.chooseButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", (event) => {
  loadImageFile(event.target.files[0]);
  event.target.value = "";
});
elements.previousLineButton.addEventListener("click", () => cycleSelectedLine(-1));
elements.nextLineButton.addEventListener("click", () => cycleSelectedLine(1));
elements.previewRepairButton.addEventListener("click", toggleRepairPreview);
elements.removeButton.addEventListener("click", fixSelectedLine);
elements.downloadButton.addEventListener("click", downloadImage);

elements.sensitivity.addEventListener("input", () => {
  elements.sensitivityValue.textContent = `${elements.sensitivity.value}%`;
  if (hasImage()) {
    runDetection({ announce: false });
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
}
window.addEventListener("resize", renderPreview);

elements.sensitivityValue.textContent = `${elements.sensitivity.value}%`;
updateDetectionSummary();
