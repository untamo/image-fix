# LineLift

LineLift is a browser-only image editor for detecting and removing distracting horizontal lines.

## Use it

Open `index.html` in a modern browser and drop in an image. Horizontal lines are detected and highlighted automatically. When lines are found, one is always selected.

Use **Up** and **Down** to cycle the detected pixel rows from top to bottom; the buttons wrap at either end. A selection is always **exactly one source pixel row high**, including when a detected stripe is several pixels thick.

A vertical fisheye is centered on that single row. It enlarges the selected row to five display pixels, its immediately adjacent image rows to four, then three, two, and one. This profile follows distance in image pixels, regardless of where other lines were detected. Outside the lens the image returns to its normal overview scale. The full image width stays visible. The lens uses native pixel scale so the selected row stays inspectable even when a large image is scaled down on a phone.

The selected row has a green outline and stays untinted; other candidate rows remain highlighted in blue. **Preview fix** temporarily shows the proposed repaired pixels in the fisheye. **Show original row** restores the original preview. Previewing does not change the image, history, or download.

The controls float over the preview on desktop and mobile. Adjust sensitivity to refresh detection; selection stays on the closest remaining line. Use **Hide controls** for more inspection space, or **Move controls to top/bottom**. Smaller screens can scroll within the panel.

Choose **Fix selected row** to apply the previewed repair to that one pixel row. The repair interpolates from rows outside the detected stripe; all other image rows remain unchanged. Fixed rows are excluded from subsequent detection until Undo or Reset restores them. **Undo** restores the previous image, selection, and sensitivity. **Reset** restores the original image. When no candidate rows remain, the preview shows the whole image normally and line navigation is disabled.

**Download PNG** exports the cleaned image at its working dimensions, without magnification or highlights. Large input images are reduced to the existing processing limits (2,600 pixels per dimension and 12 megapixels). Processing stays local in the browser; no upload or server is required.

Detection is designed for thin, straight light or dark horizontal stripes across a substantial part of the image, including multi-pixel bands. Vertical, short, curved, or diagonal marks are not supported. Review the highlights before removing; interpolation can soften detailed areas.

## Checks

Run `node --check app.js` and `node --test tests/app.test.cjs` (Node.js 18+). The dependency-free tests cover horizontal-only detection and cleanup, zero/one/many selections, navigation wraparound, pixel-distance fisheye magnification and rendering, responsive highlight mapping, sensitivity changes, Undo, Reset, one-row-only edits, repair preview/apply equivalence, and clean PNG export. They do not replace testing with real photographs in a browser.
