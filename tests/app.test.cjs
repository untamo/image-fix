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
    for (const method of ["setTransform", "clearRect", "fillRect", "beginPath", "moveTo", "lineTo", "stroke", "putImageData"]) {
      context[method] = (...args) => calls.push({ method, args, lineWidth: context.lineWidth });
    }
    return {
      value: "", checked: false, textContent: "", disabled: false, dataset: {},
      attributes: {}, classList: { toggle() {}, add() {}, remove() {} },
      width: 300, height: 150, context,
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
  nodes.get("sensitivity").value = "60";
  const inputs = [...html.matchAll(/<input type="radio" name="orientation" value="([^"]+)"/g)]
    .map(([, value]) => Object.assign(node(), { value }));
  const context = vm.createContext({
    ImageData: ImageDataStub,
    window: { devicePixelRatio: 2, addEventListener() {}, setTimeout() {} },
    ResizeObserver: class { constructor(callback) { resizeCallback = callback; } observe() {} },
    URL: { createObjectURL() { return "blob:local-test"; }, revokeObjectURL() {} },
    document: {
      querySelector(selector) { return nodes.get(selector.slice(1)) || null; },
      querySelectorAll(selector) { return selector.includes('input[name="orientation"]') ? inputs : []; },
      addEventListener() {},
      createElement(tag) { const element = node(); if (tag === "canvas") canvases.push(element); return element; },
    },
  });
  vm.runInContext(`${source}\nthis.testState = state;`, context);
  return {
    context, state: context.testState, nodes, inputs, bounds, canvases,
    resize() { resizeCallback(); },
    load(image) {
      context.testState.sourceImageData = context.cloneImageData(image);
      context.testState.workingImageData = context.cloneImageData(image);
      context.testState.history = [];
      context.renderWorkingImage();
      context.runDetection();
    },
    select(value) {
      inputs.forEach((input) => { input.checked = input.value === value; });
      inputs.find((input) => input.value === value).fire("change");
    },
  };
}

function fixture(orientation, thickness = 3, ink = 20, width = 300, height = 200) {
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

test("native direction selection updates labels, checked state, and detections", () => {
  const app = harness();
  app.select("horizontal");
  assert.equal(app.state.orientation, "horizontal");
  assert.equal(app.nodes.get("detectButtonLabel").textContent, "Detect horizontal lines");
  assert.equal(app.nodes.get("directionHint").textContent, "Horizontal selected");
  app.load(fixture("horizontal"));
  assert.equal(app.state.detections.length, 1);
  assert.match(app.nodes.get("statusText").textContent, /Horizontal: 1 found/);
  app.select("vertical");
  assert.equal(app.state.detections.length, 0);
  app.select("horizontal");
  assert.equal(app.state.detections[0].orientation, "horizontal");
  assert.equal(app.inputs.filter((input) => input.checked).length, 1);
});

test("detects and removes thin and thick light/dark lines in both axes", () => {
  const app = harness();
  for (const orientation of ["vertical", "horizontal"]) {
    for (const thickness of [1, 3, 8]) {
      for (const ink of [20, 240]) {
        const image = fixture(orientation, thickness, ink);
        const detections = app.context.detectLines(image, 60, orientation);
        assert.equal(detections.length, 1, `${orientation}/${thickness}/${ink}`);
        assert.equal(detections[0].width, thickness);
        assert.equal(detections[0].start, orientation === "vertical" ? 70 : 90);
        app.context.interpolateDetectedLine(image.data, image.width, image.height, detections[0]);
        assert.ok(cleanBackground(image), `${orientation}/${thickness}/${ink} cleanup`);
      }
    }
  }
});

test("Both detects and removes crossing lines without changing the original", () => {
  const app = harness();
  app.load(fixture("both", 8));
  const original = app.state.sourceImageData.data.slice();
  app.select("both");
  assert.equal(app.state.detections.length, 2);
  app.nodes.get("removeButton").click();
  assert.ok(cleanBackground(app.state.workingImageData));
  assert.deepEqual(app.state.sourceImageData.data, original);
});

test("switching directions scans the edited image, not removed lines in the original", () => {
  const app = harness();
  app.load(fixture("both"));
  app.nodes.get("removeButton").click();
  app.select("both");
  assert.equal(app.state.detections.length, 1);
  assert.equal(app.state.detections[0].orientation, "horizontal");
  app.select("horizontal");
  app.nodes.get("removeButton").click();
  app.select("both");
  assert.equal(app.state.detections.length, 0);
  assert.ok(cleanBackground(app.state.workingImageData));
});

test("Undo restores matching direction, sensitivity, pixels, and guides", () => {
  const app = harness();
  app.select("horizontal");
  app.load(fixture("horizontal", 8));
  const original = app.state.workingImageData.data.slice();
  app.nodes.get("removeButton").click();
  app.select("vertical");
  app.nodes.get("sensitivity").value = "95";
  app.nodes.get("undoButton").click();
  assert.equal(app.state.orientation, "horizontal");
  assert.equal(app.nodes.get("sensitivity").value, "60");
  assert.equal(app.inputs.find((input) => input.value === "horizontal").checked, true);
  assert.deepEqual(app.state.workingImageData.data, original);
  assert.equal(app.state.detections[0].orientation, "horizontal");
  app.nodes.get("resetButton").click();
  assert.deepEqual(app.state.workingImageData.data, original);
  assert.equal(app.state.history.length, 0);
});

test("horizontal guides span left to right with 3px cores, even after resizing", () => {
  const app = harness();
  app.select("horizontal");
  app.load(fixture("horizontal", 1, 20, 2600, 1800));
  const guide = app.nodes.get("guideCanvas");
  guide.context.calls.length = 0;
  app.context.drawGuides();
  assert.equal(guide.width, 600);
  assert.equal(guide.height, 400);
  const moves = guide.context.calls.filter((call) => call.method === "moveTo");
  const ends = guide.context.calls.filter((call) => call.method === "lineTo");
  assert.equal(moves[0].args[0], 0);
  assert.equal(ends[0].args[0], 300);
  assert.equal(moves[0].args[1], ends[0].args[1]);
  assert.deepEqual(guide.context.calls.filter((call) => call.method === "stroke").map((call) => call.lineWidth), [6, 3]);
  app.bounds.width = 450;
  app.bounds.height = 300;
  app.resize();
  assert.equal(guide.width, 900);
  assert.equal(guide.height, 600);
});

test("changing direction reveals hidden guides and updates the legend summary", () => {
  const app = harness();
  app.load(fixture("both"));
  app.nodes.get("toggleGuidesButton").click();
  assert.match(app.nodes.get("guideSummary").textContent, /hidden/);
  app.select("horizontal");
  assert.equal(app.state.guidesVisible, true);
  assert.match(app.nodes.get("guideSummary").textContent, /1 horizontal guide highlighted/);
});

test("sensitivity can detect faint lines; plain backgrounds and hard edges stay unmarked", () => {
  const app = harness();
  const faint = fixture("horizontal", 3, 151);
  assert.equal(app.context.detectLines(faint, 10, "horizontal").length, 0);
  assert.equal(app.context.detectLines(faint, 95, "horizontal").length, 1);
  const blank = fixture("vertical", 0);
  for (const orientation of ["vertical", "horizontal"]) {
    assert.equal(app.context.detectLines(blank, 95, orientation).length, 0);
  }
  for (let y = 100; y < blank.height; y += 1) {
    for (let x = 0; x < blank.width; x += 1) {
      const pixel = (y * blank.width + x) * 4;
      blank.data.fill(30, pixel, pixel + 3);
    }
  }
  assert.equal(app.context.detectLines(blank, 95, "horizontal").length, 0);
  blank.data.fill(0);
  assert.equal(app.context.detectLines(blank, 95, "horizontal").length, 0);
});

test("PNG export uses only image pixels, never the highlight canvas", () => {
  const app = harness();
  app.load(fixture("both"));
  app.nodes.get("downloadButton").click();
  const calls = app.canvases[0].context.calls;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "putImageData");
  assert.equal(calls[0].args[0], app.state.workingImageData);
});

test("HTML references matching versioned script/style files and accessible radio choices", () => {
  const assets = [...html.matchAll(/(?:src|href)="((?:app\.js|styles\.css)[^"]*)"/g)].map((match) => match[1]);
  assert.equal(assets.length, 2);
  assert.equal(assets[0].split("?")[1], assets[1].split("?")[1]);
  for (const asset of assets) {
    assert.match(asset, /\?v=/);
    assert.ok(fs.existsSync(path.join(root, asset.split("?")[0])));
  }
  assert.equal((html.match(/type="radio" name="orientation"/g) || []).length, 3);
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.match(css, /input:checked \+ span/);
  assert.match(css, /hover input:not\(:checked\)/);
});
