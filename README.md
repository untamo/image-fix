# LineLift

LineLift is a browser-only image editor for detecting and removing distracting horizontal lines.

## Use it

Open `index.html` in a modern browser and drop in an image. Horizontal lines are detected automatically. When lines are found, one is always selected.

Use the **↑** and **↓** buttons directly above and below the outlined zoom area to cycle detected lines from top to bottom; the buttons wrap at either end. Each stripe has **one selection**, even when its defect or color bleed spans several pixel rows. Its strongest damaged row is used as the **one-pixel-high focus**; ties favor the center. Navigation is disabled when there is only one line.

A vertical fisheye is centered on that single row. It enlarges the selected row to ten display pixels, its immediately adjacent image rows to eight, then six, four, and two. This profile follows distance in image pixels, regardless of where other lines were detected. Outside the lens the image returns to its normal overview scale. The full image width stays visible. The ordinary fisheye preview does not change brightness or tint: it displays the original image pixels at a larger size. Only **Preview fix** substitutes repaired pixels. The lens uses native pixel scale so the selected row stays inspectable even when a large image is scaled down on a phone.

Only the outer perimeter of the zoomed area has a green outline. All image rows inside it remain free of highlights, fills, and guide strokes. **Preview fix** temporarily shows the proposed repaired strip in the fisheye. **Show original** restores the original preview. Previewing does not change the image, history, or download.

The controls float over the preview on desktop and mobile. Adjust sensitivity to refresh detection; selection stays on the closest remaining line. Use **Hide controls** for more inspection space, or **Move controls to top/bottom**. Smaller screens can scroll within the panel.

Choose **Fix line** to repair the selected stripe, including any detected color bleed around it. The selection remains exactly one pixel row; the repair can cover several rows when the defect extends beyond its center. The footer reports the repair's row range before applying it. Clean reference rows are chosen outside that range, and only pixels within the reported strip are changed. This prevents JPEG halos from being copied into the repair.

Detection considers brightness and color differences so tinted residue can be detected even when it has little brightness contrast. The repair expands through coherent neighboring color contamination, up to six rows beyond each detected edge. It uses stable image columns to distinguish bleed from texture; preview the result on detailed areas.

Fixed rows are excluded from subsequent detection until Undo or Reset restores them. **Undo** restores the complete previous image, selection, and sensitivity. **Reset** restores the original image. When no candidate rows remain, the preview shows the whole image normally and line navigation is disabled.

**Download PNG** exports the cleaned image at its working dimensions, without magnification or highlights. Large input images are reduced to the existing processing limits (2,600 pixels per dimension and 12 megapixels). Processing stays local in the browser; no upload or server is required.

Detection is designed for thin, straight light or dark horizontal stripes across a substantial part of the image, including multi-pixel bands. Vertical, short, curved, or diagonal marks are not supported. Preview the repair before applying it; interpolation can soften detailed areas.

## Checks

Run `node --check app.js` and `node --test tests/app.test.cjs` (Node.js 18+). The dependency-free tests cover horizontal-only detection and cleanup, zero/one/many selections, navigation wraparound, pixel-distance fisheye magnification and rendering, responsive highlight mapping, sensitivity changes, Undo, Reset, JPEG color-bleed repair, preservation outside the repair strip, repair preview/apply equivalence, and clean PNG export. They do not replace testing with real photographs in a browser.
