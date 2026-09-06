const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

class ImageDataStub {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

// Exercise the complete script and its event handlers without a browser dependency.
function harness() {
  const bounds = { width: 300, height: 200 };
  const nodes = new Map();
  const canvases = [];
  let resizeCallback;
  function node() {
    const listeners = new Map();
    const calls = [];
    const context = { calls };
    for (const method of ["setTransform", "clearRect", "fillRect", "beginPath", "moveTo", "lineTo", "stroke", "putImageData", "drawImage", "strokeRect"]) {
      context[method] = (...args) => calls.push({ method, args, lineWidth: context.lineWidth, fillStyle: context.fillStyle, strokeStyle: context.strokeStyle });
    }
    return {
      value: "", checked: false, textContent: "", disabled: false, dataset: {},
      attributes: {}, classList: { toggle() {}, add() {}, remove() {} },
      width: 300, height: 150, context, style: {}, parentElement: { style: {} },
      setAttribute(key, value) { this.attributes[key] = value; },
      getContext() { return context; },
      getBoundingClientRect() { return bounds; },
      addEventListener(event, handler) { listeners.set(event, handler); },
      fire(event) { listeners.get(event)?.({ target: this }); },
      click() { this.fire("click"); },
      toBlob(callback) { callback({ type: "image/png" }); },
    };
  }
  for (const [, id] of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(id, node());
  nodes.get("editorToolbar").getBoundingClientRect = () => ({ top: 0, bottom: 20 });
  nodes.get("controlsPanel").getBoundingClientRect = () => ({ top: bounds.height - 40, bottom: bounds.height, height: 40 });
  bounds.top = 0;
  nodes.get("sensitivity").value = "60";
  const context = vm.createContext({
    ImageData: ImageDataStub,
    window: { get innerHeight() { return bounds.height + 58; }, devicePixelRatio: 2, addEventListener() {}, setTimeout() {} },
    ResizeObserver: class { constructor(callback) { resizeCallback = callback; } observe() {} },
    URL: { createObjectURL() { return "blob:local-test"; }, revokeObjectURL() {} },
    document: {
      querySelector(selector) { return nodes.get(selector.slice(1)) || null; },

      addEventListener() {},
      createElement(tag) { const element = node(); if (tag === "canvas") canvases.push(element); return element; },
    },
  });
  vm.runInContext(`${source}\nthis.testState = state;`, context);
  return {
    context, state: context.testState, nodes, bounds, canvases,
    resize() { resizeCallback(); },
    load(image) {
      context.testState.sourceImageData = context.cloneImageData(image);
      context.testState.workingImageData = context.cloneImageData(image);
      context.testState.history = [];
      context.testState.detections = [];
      context.testState.repairedRows = [];
      context.testState.previewRepair = false;
      context.testState.selectedLineIndex = -1;
      context.renderWorkingImage();
      context.runDetection();
    },
  };
}

function fixture(orientation, thickness = 1, ink = 20, width = 300, height = 200) {
  const image = new ImageDataStub(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const vertical = x >= 70 && x < 70 + thickness;
      const horizontal = y >= 90 && y < 90 + thickness;
      const stripe = (orientation !== "horizontal" && vertical) || (orientation !== "vertical" && horizontal);
      const pixel = (y * width + x) * 4;
      image.data.fill(stripe ? ink : 160, pixel, pixel + 3);
      image.data[pixel + 3] = 255;
    }
  }
  return image;
}

function cleanBackground(image) {
  return image.data.every((value, index) => value === (index % 4 === 3 ? 255 : 160));
}

function multipleLines(positions = [20, 45, 70, 95, 120, 145, 170], faint = -1) {
  const image = fixture("horizontal", 0);
  positions.forEach((y, index) => {
    for (let row = y; row < y + 1; row += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const pixel = (row * image.width + x) * 4;
        image.data.fill(index === faint ? 151 : 20, pixel, pixel + 3);
      }
    }
  });
  return image;
}

function near(actual, expected, message = "") {
  assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);
}

test("empty and single-line images have valid selection and safe navigation", () => {
  const app = harness();
  assert.equal(app.state.selectedLineIndex, -1);
  assert.ok(app.nodes.get("previousLineButton").disabled);
  app.context.cycleSelectedLine(1);
  app.load(fixture("horizontal"));
  assert.equal(app.state.selectedLineIndex, 0);
  assert.equal(app.nodes.get("selectedLineStatus").textContent, "Row 91 · 1 px");
  assert.ok(app.nodes.get("nextLineButton").disabled);
  app.context.cycleSelectedLine(-1);
  assert.equal(app.state.selectedLineIndex, 0);
  app.load(fixture("horizontal", 0));
  assert.equal(app.state.selectedLineIndex, -1);
  assert.equal(app.nodes.get("selectedLineStatus").textContent, "No lines detected");
  assert.ok(app.nodes.get("removeButton").disabled);
});

test("Up and Down enable only toward remaining lines and stop at the image ends", () => {
  const app = harness();
  app.load(multipleLines());
  const original = app.state.workingImageData.data.slice();
  assert.equal(app.state.detections.length, 7);
  assert.equal(app.state.selectedLineIndex, 0);
  assert.ok(app.nodes.get("previousLineButton").disabled);
  assert.equal(app.nodes.get("nextLineButton").disabled, false);
  app.nodes.get("previousLineButton").click();
  assert.equal(app.state.selectedLineIndex, 0);
  for (let i = 1; i < 7; i += 1) {
    app.nodes.get("nextLineButton").click();
    assert.equal(app.state.selectedLineIndex, i);
    assert.equal(app.nodes.get("previousLineButton").disabled, false);
    assert.equal(app.nodes.get("nextLineButton").disabled, i === 6);
  }
  app.nodes.get("nextLineButton").click();
  assert.equal(app.state.selectedLineIndex, 6);
  app.nodes.get("previousLineButton").click();
  assert.equal(app.state.selectedLineIndex, 5);
  assert.equal(app.nodes.get("nextLineButton").disabled, false);
  assert.equal(app.state.history.length, 0);
  assert.deepEqual(app.state.workingImageData.data, original);
});

test("horizontal-only detection and cleanup leave vertical lines untouched", () => {
  const app = harness();
  app.load(fixture("vertical"));
  assert.equal(app.state.detections.length, 0);
  app.load(fixture("both"));
  assert.equal(app.state.detections.length, 1);
  assert.equal(app.state.detections[0].start, 90);
  app.nodes.get("removeButton").click();
  assert.deepEqual(app.state.workingImageData.data, fixture("vertical").data);
});

test("detects and removes thin/thick light and dark horizontal lines", () => {
  const app = harness();
  for (const thickness of [1, 3, 8]) {
    for (const ink of [20, 240]) {
      const image = fixture("horizontal", thickness, ink);
      const lines = app.context.detectLines(image, 60);
      assert.equal(lines.length, 1, `${thickness}/${ink}`);
      assert.equal(lines[0].width, thickness);
      const plan = app.context.planLineRepair(image, { start: lines[0].start, bandStart: lines[0].start, bandEnd: lines[0].end });
      image.data.set(plan.pixels.data, plan.start * image.width * 4);
      assert.ok(cleanBackground(image));
    }
  }
});

test("fisheye depends on source-row distance even with no nearby detections", () => {
  const app = harness();
  for (const [width, height] of [[300, 200], [150, 100], [900, 600]]) {
    for (const row of [0, 100, 199]) {
      const lines = [{ start: row, end: row, width: 1 }];
      const layout = app.context.buildFocusLayout(300, 200, width, height, lines, 0);
      for (let y = 0; y < 200; y += 1) {
        const actual = app.context.mappedY(layout, y + 1) - app.context.mappedY(layout, y);
        near(actual, Math.abs(y - row) <= 4 ? 2 * (5 - Math.abs(y - row)) : layout.scale);
      }
      near(app.context.mappedY(layout, row + 0.5), height / 2);
      assert.equal(layout.segments[0].start, 0);
      assert.equal(layout.segments.at(-1).end, 200);
      layout.segments.forEach((part, index) => {
        assert.ok(part.end > part.start);
        if (index) {
          near(layout.segments[index - 1].end, part.start);
          near(layout.segments[index - 1].bottom, part.top);
        }
      });
      // An unrelated detection does not enlarge any extra image band.
      const otherRow = row < 100 ? 150 : 20;
      const withOther = app.context.buildFocusLayout(300, 200, width, height,
        [lines[0], { start: otherRow, end: otherRow, width: 1 }], 0);
      assert.deepEqual(withOther.segments, layout.segments);
    }
  }
});

test("actual image rendering expands source bands and guides follow their mapped edges", () => {
  const app = harness();
  app.load(multipleLines());
  app.nodes.get("nextLineButton").click();
  const preview = app.nodes.get("previewCanvas");
  preview.context.calls.length = 0;
  app.context.renderPreview();
  const draws = preview.context.calls.filter((call) => call.method === "drawImage");
  assert.ok(draws.length > 1);
  assert.ok(draws.some((call) => Math.abs(call.args[8] / call.args[4] - 10) < 1e-7));
  draws.forEach((call) => {
    assert.equal(call.args[0], app.canvases[0]);
    assert.ok(call.args[2] >= 0 && call.args[2] + call.args[4] <= 200 + 1e-7);
  });
  const guide = app.nodes.get("guideCanvas");
  guide.context.calls.length = 0;
  app.context.drawGuides();
  const outlines = guide.context.calls.filter((call) => call.method === "strokeRect");
  assert.equal(outlines.length, 1);
  assert.ok(!guide.context.calls.some((call) => ["fillRect", "stroke", "lineTo"].includes(call.method)),
    "No fills or row guides may obscure pixels inside the zoomed area");
  const line = app.state.detections[app.state.selectedLineIndex];
  const lens = app.context.focusBounds(app.state.previewLayout, line, 200);
  near(outlines[0].args[1], lens.top - 0.5);
  near(outlines[0].args[3], lens.bottom - lens.top + 1);
  near(app.context.mappedY(app.state.previewLayout, line.start + 1) - app.context.mappedY(app.state.previewLayout, line.start), 10);
  const up = app.nodes.get("previousLineButton");
  const down = app.nodes.get("nextLineButton");
  near(parseFloat(up.style.top) + 44, lens.top - 6);
  near(parseFloat(down.style.top), lens.bottom + 6);
  near(parseFloat(up.style.left), app.state.previewLayout.viewWidth / 2);
  near(parseFloat(down.style.left), parseFloat(up.style.left));
  app.bounds.width = 450;
  app.bounds.height = 360;
  app.resize();
  const resizedLens = app.context.focusBounds(app.state.previewLayout, line, 200);
  near(parseFloat(up.style.top) + 44, resizedLens.top - 6);
  near(parseFloat(down.style.top), resizedLens.bottom + 6);
});

test("sensitivity preserves the closest selected line when earlier faint lines disappear", () => {
  const app = harness();
  app.nodes.get("sensitivity").value = "95";
  app.load(multipleLines([20, 70, 120], 0));
  assert.equal(app.state.detections.length, 3);
  app.nodes.get("nextLineButton").click();
  assert.equal(app.state.detections[app.state.selectedLineIndex].start, 70);
  app.nodes.get("sensitivity").value = "10";
  app.nodes.get("sensitivity").fire("input");
  assert.equal(app.state.detections.length, 2);
  assert.equal(app.state.selectedLineIndex, 0);
  assert.equal(app.state.detections[0].start, 70);
});

test("Undo restores pixels, sensitivity, selection and magnification; Reset restores source", () => {
  const app = harness();
  app.load(multipleLines());
  const original = app.state.workingImageData.data.slice();
  app.nodes.get("nextLineButton").click();
  app.nodes.get("removeButton").click();
  assert.notDeepEqual(app.state.workingImageData.data, original);
  assert.equal(app.state.repairedRows.length, 1);
  app.nodes.get("sensitivity").value = "95";
  app.context.undoLastEdit();
  assert.equal(app.state.selectedLineIndex, 1);
  assert.equal(app.nodes.get("sensitivity").value, "60");
  assert.deepEqual(app.state.workingImageData.data, original);
  app.nodes.get("removeButton").click();
  app.context.resetImage();
  assert.deepEqual(app.state.workingImageData.data, original);
  assert.equal(app.state.history.length, 0);
  assert.ok(app.state.selectedLineIndex >= 0);
});

test("resizing redraws display pixels and keeps selected image bands centered in clear space", () => {
  const app = harness();
  app.load(multipleLines());
  app.bounds.width = 450;
  app.bounds.height = 300;
  app.resize();
  assert.equal(app.nodes.get("previewCanvas").width, 900);
  assert.equal(app.nodes.get("guideCanvas").height, Math.round(app.state.previewLayout.viewHeight * 2));
  assert.ok(app.state.previewLayout.viewHeight < app.bounds.height);
  const line = app.state.detections[app.state.selectedLineIndex];
  const center = app.context.mappedY(app.state.previewLayout, line.start + line.width / 2);
  assert.ok(center >= 75 && center <= app.state.previewLayout.viewHeight - 75);
  assert.ok(app.nodes.get("previousLineButton"));
  assert.ok(app.nodes.get("nextLineButton"));
  app.load(fixture("horizontal", 1, 20, 1800, 200));
  const lineCenter = app.context.mappedY(app.state.previewLayout,
    app.state.detections[app.state.selectedLineIndex].start + 0.5);
  assert.ok(lineCenter >= 75 && lineCenter <= app.state.previewLayout.viewHeight - 75);
  assert.ok(parseFloat(app.nodes.get("previousLineButton").style.top) >= 0);
  assert.ok(parseFloat(app.nodes.get("nextLineButton").style.top) + 44 <= app.bounds.height);

});

test("export contains original-size image pixels without highlights or magnification", () => {
  const app = harness();
  app.load(multipleLines());
  app.nodes.get("nextLineButton").click();
  app.nodes.get("previewRepairButton").click();
  app.nodes.get("downloadButton").click();
  const exported = app.canvases.at(-1);
  assert.equal(exported.width, 300);
  assert.equal(exported.height, 200);
  assert.equal(exported.context.calls.length, 1);
  assert.equal(exported.context.calls[0].method, "putImageData");
  assert.equal(exported.context.calls[0].args[0], app.state.workingImageData);
});

test("plain backgrounds, hard edges and transparency stay unmarked", () => {
  const app = harness();
  const blank = fixture("horizontal", 0);
  assert.equal(app.context.detectLines(blank, 95).length, 0);
  for (let y = 100; y < blank.height; y += 1) {
    for (let x = 0; x < blank.width; x += 1) {
      const pixel = (y * blank.width + x) * 4;
      blank.data.fill(30, pixel, pixel + 3);
    }
  }
  assert.equal(app.context.detectLines(blank, 95).length, 0);
  blank.data.fill(0);
  assert.equal(app.context.detectLines(blank, 95).length, 0);
});

test("HTML has selection buttons, no direction/highlight switches, and matching versioned assets", () => {
  assert.doesNotMatch(html, /name="orientation"|toggleGuidesButton|Hide guides|Vertical/);
  assert.match(html, /id="previousLineButton"/);
  assert.match(html, /id="nextLineButton"/);
  assert.match(html, /id="previewRepairButton"/);
  assert.match(html, /id="removeButton"[^>]+aria-label="Fix"/);
  const actions = html.slice(html.indexOf('class="image-actions"'), html.indexOf('class="sensitivity-dock"'));
  assert.deepEqual([...actions.matchAll(/<button[^>]+id="([^"]+)"/g)].map((match) => match[1]),
    ["previewRepairButton", "removeButton", "downloadButton"]);
  assert.equal((actions.match(/<svg /g) || []).length, 3);
  assert.doesNotMatch(html, /id="(?:moveControlsButton|toggleControlsButton|undoButton|resetButton)"/);
  assert.match(html, /id="sensitivity" type="range"/);
  assert.doesNotMatch(html, /class="(?:canvas-footer|guide-legend|page-footer)"/);
  assert.match(html, /class="sr-only"/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  const assets = [...html.matchAll(/(?:src|href)="((?:app\.js|styles\.css)[^"]*)"/g)].map((match) => match[1]);
  assert.equal(assets.length, 2);
  assert.equal(assets[0].split("?")[1], assets[1].split("?")[1]);
  for (const asset of assets) assert.ok(fs.existsSync(path.join(root, asset.split("?")[0])));
});

test("one-pixel selection repairs the full detected stripe and preserves all surrounding pixels", () => {
  const app = harness();
  app.load(fixture("horizontal", 8));
  assert.equal(app.state.detections.length, 1);
  assert.ok(app.nodes.get("previousLineButton").disabled);
  assert.ok(app.nodes.get("nextLineButton").disabled);
  for (const line of app.state.detections) {
    assert.equal(line.width, 1);
    assert.equal(line.start, line.end);
  }
  app.nodes.get("nextLineButton").click();
  const selectedRow = app.state.detections[app.state.selectedLineIndex].start;
  const original = app.state.workingImageData.data.slice();
  app.nodes.get("removeButton").click();
  for (let y = 0; y < 200; y += 1) {
    const row = app.state.workingImageData.data.slice(y * 300 * 4, (y + 1) * 300 * 4);
    if (y >= 90 && y < 98) assert.ok(row.every((value, index) => value === (index % 4 === 3 ? 255 : 160)));
    else assert.deepEqual(row, original.slice(y * 300 * 4, (y + 1) * 300 * 4));
  }
  assert.ok(!app.state.detections.some((line) => line.start === selectedRow));
  app.nodes.get("sensitivity").value = "95";
  app.nodes.get("sensitivity").fire("input");
  assert.ok(!app.state.detections.some((line) => line.start === selectedRow));
  app.context.undoLastEdit();
  assert.equal(app.state.repairedRows.length, 0);
  assert.equal(app.state.detections[app.state.selectedLineIndex].start, selectedRow);
  assert.deepEqual(app.state.workingImageData.data, original);
});

test("Preview fix is reversible and its single-row pixels exactly match the applied repair", () => {
  const app = harness();
  app.load(fixture("horizontal", 1));
  const original = app.state.workingImageData.data.slice();
  const selectedRow = app.state.detections[app.state.selectedLineIndex].start;
  app.nodes.get("previewRepairButton").click();
  assert.ok(app.state.previewRepair);
  assert.equal(app.nodes.get("previewRepairButton").attributes["aria-pressed"], "true");
  assert.deepEqual(app.state.workingImageData.data, original);
  assert.equal(app.state.history.length, 0);
  const repair = app.canvases[1];
  assert.equal(repair.height, 1);
  const previewStrip = repair.context.calls.find((call) => call.method === "putImageData").args[0].data.slice();
  app.nodes.get("previewRepairButton").click();
  assert.equal(app.state.previewRepair, false);
  app.nodes.get("removeButton").click();
  assert.deepEqual(app.state.workingImageData.data.slice(selectedRow * 300 * 4, (selectedRow + 1) * 300 * 4), previewStrip);
  assert.equal(app.state.selectedLineIndex, -1);
  assert.ok(app.nodes.get("previewRepairButton").disabled);
  app.context.undoLastEdit();
  assert.deepEqual(app.state.workingImageData.data, original);
});

function colorBleedFixture() {
  const image = fixture("horizontal", 0);
  for (let pixel = 0; pixel < image.data.length; pixel += 4) image.data.set([125, 61, 20, 255], pixel);
  // Bright core with a faint, several-row chroma halo, as in the reported JPEG.
  const colors = [[123, 62, 31], [121, 58, 37], [158, 92, 77], [121, 56, 37], [123, 59, 26]];
  colors.forEach((rgb, offset) => {
    for (let x = 0; x < image.width; x += 1) image.data.set([...rgb, 255], ((88 + offset) * image.width + x) * 4);
  });
  return image;
}

test("repair includes the JPEG color halo and samples beyond all contaminated rows", () => {
  const app = harness();
  const image = colorBleedFixture();
  // Even a detector that only found the bright center must repair its halo.
  const plan = app.context.planLineRepair(image, { start: 90, bandStart: 90, bandEnd: 90 });
  assert.equal(plan.start, 88);
  assert.equal(plan.end, 92);
  for (let pixel = 0; pixel < plan.pixels.data.length; pixel += 4) {
    assert.deepEqual(Array.from(plan.pixels.data.slice(pixel, pixel + 4)), [125, 61, 20, 255]);
  }
});

test("multi-row preview and apply use identical repair pixels and Undo restores the complete halo", () => {
  const app = harness();
  app.load(colorBleedFixture());
  const original = app.state.workingImageData.data.slice();
  const plan = app.context.getRepairPlan();
  assert.equal(plan.pixels.height, 5);
  app.nodes.get("previewRepairButton").click();
  const previewStrip = app.canvases[1].context.calls.find((call) => call.method === "putImageData").args[0];
  assert.deepEqual(previewStrip.data, plan.pixels.data);
  assert.deepEqual(app.state.workingImageData.data, original);
  const draws = app.nodes.get("previewCanvas").context.calls.filter((call) => call.method === "drawImage" && call.args[0] === app.canvases[1]);
  assert.equal(draws.length, 5);
  draws.forEach((call, index) => {
    assert.equal(call.args[2], index);
    assert.equal(call.args[4], 1);
    const layout = app.state.previewLayout;
    near(call.args[8], app.context.mappedY(layout, plan.start + index + 1) - app.context.mappedY(layout, plan.start + index));
  });
  app.nodes.get("removeButton").click();
  const start = plan.start * 300 * 4;
  const end = (plan.end + 1) * 300 * 4;
  assert.deepEqual(app.state.workingImageData.data.slice(start, end), previewStrip.data);
  assert.deepEqual(app.state.workingImageData.data.slice(0, start), original.slice(0, start));
  assert.deepEqual(app.state.workingImageData.data.slice(end), original.slice(end));
  assert.equal(app.state.selectedLineIndex, -1);
  app.context.undoLastEdit();
  assert.deepEqual(app.state.workingImageData.data, original);
});

test("color-only horizontal damage is detected even at near-equal luminance", () => {
  const app = harness();
  const image = fixture("horizontal", 0);
  for (let x = 0; x < image.width; x += 1) image.data.set([190, 148, 190, 255], (90 * image.width + x) * 4);
  assert.ok(Math.abs(app.context.luminance(190, 148, 190) - 160) < 1);
  const lines = app.context.detectLines(image, 60);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].start, 90);
});

test("image area trims empty space before sensitivity for portrait and landscape images", () => {
  const app = harness();
  for (const [width, height, row] of [[1152, 1536, 1103], [1800, 800, 400]]) {
    const layout = app.context.fitPreviewLayout(width, height, 400, 700, [{ start: row }], 0);
    near(app.context.mappedY(layout, height), layout.viewHeight);
    assert.ok(layout.viewHeight < 700);
    const lens = app.context.focusBounds(layout, { start: row }, height);
    assert.ok(lens.top >= 50);
    assert.ok(lens.bottom + 50 <= layout.viewHeight);
  }
  const plain = app.context.fitPreviewLayout(1800, 1000, 400, 700, [], -1);
  near(app.context.mappedY(plain, 0), 0);
  near(app.context.mappedY(plain, 1000), plain.viewHeight);
  const shallow = app.context.fitPreviewLayout(1800, 200, 400, 700, [], -1);
  assert.ok(shallow.viewHeight >= 196, "All three action buttons remain reachable");
  near(app.context.mappedY(shallow, 200), shallow.viewHeight);
});
