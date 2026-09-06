# LineLift

LineLift is a browser-only image editor for detecting and removing distracting horizontal lines.

## Use it

Open `index.html` in a modern browser and drop in an image. Horizontal lines are detected and highlighted automatically. When lines are found, one is always selected.

Use **Up** and **Down** to cycle the selection from top to bottom; the buttons wrap at either end. The selected image band is magnified vertically to **5×** its normal preview size. Successive detected lines above and below expand to **4×, 3×, 2×**, then return to **1×**. Magnification enlarges the actual image pixels and nearby context, keeps the full image width, and centers the selection in the area clear of the floating controls. Green marks the selected line; blue marks the others. There is no highlight visibility switch or direction selector.

The controls float over the preview on desktop and mobile. Adjust sensitivity to refresh detection; selection stays on the closest remaining line. Use **Hide controls** for more inspection space, or **Move controls to top/bottom**. Smaller screens can scroll within the panel.

Choose **Remove horizontal lines** to remove all detected lines, or **Undo** to restore the previous image, selection, and sensitivity. **Reset** restores the original image. When no lines are detected, the preview shows the whole image normally and line navigation is disabled.

**Download PNG** exports the cleaned image at its working dimensions, without magnification or highlights. Large input images are reduced to the existing processing limits (2,600 pixels per dimension and 12 megapixels). Processing stays local in the browser; no upload or server is required.

Detection is designed for thin, straight light or dark horizontal stripes across a substantial part of the image, including multi-pixel bands. Vertical, short, curved, or diagonal marks are not supported. Review the highlights before removing; interpolation can soften detailed areas.

## Checks

Run `node --check app.js` and `node --test tests/app.test.cjs` (Node.js 18+). The dependency-free tests cover horizontal-only detection and cleanup, zero/one/many selections, navigation wraparound, exact magnification factors and image-band rendering, responsive highlight mapping, sensitivity changes, Undo, Reset, and clean PNG export. They do not replace testing with real photographs in a browser.
