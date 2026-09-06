# LineLift

LineLift is a browser-only image editor for detecting and removing distracting horizontal lines.

## Use it

Open `index.html` in a modern browser. The opening screen has one image-loading target: choose an image or drop it there. Horizontal lines are detected automatically. When lines are found, one is always selected.

Use the **↑** and **↓** buttons directly above and below the outlined zoom area to cycle detected lines from top to bottom; each arrow is enabled only when another line exists in that direction, and navigation stops at either end. Each stripe has **one selection**, even when its defect or color bleed spans several pixel rows. Its strongest damaged row is used as the **one-pixel-high focus**; ties favor the center. Navigation is disabled when there is only one line.

A vertical fisheye is centered on that single row. It enlarges the selected row to ten display pixels, its immediately adjacent image rows to eight, then six, four, and two. This profile follows distance in image pixels, regardless of where other lines were detected. Outside the lens the image returns to its normal overview scale. The full image width stays visible. The ordinary fisheye preview does not change brightness or tint: it displays the original image pixels at a larger size. Only **Preview fix** substitutes repaired pixels. The lens uses native pixel scale so the selected row stays inspectable even when a large image is scaled down on a phone.

Only the outer perimeter of the zoomed area has a green outline. All image rows inside it remain free of highlights, fills, and guide strokes. **Preview fix** temporarily shows the proposed repaired strip in the fisheye. **Show original** restores the original preview. Previewing does not change the image, history, or download.

Once an image is loaded, the action buttons appear as a single icon column on the right of the image: **Preview** (eye), **Fix** (wand), and **Save** (download). Preview has a highlighted active state and toggles between the proposed repair and original pixels. Save downloads the cleaned PNG. Buttons have accessible names and tooltips.

The **↑ / ↓** navigation arrows remain immediately above and below the zoom outline, and sensitivity occupies the bottom row of the same image component, below the image viewport in normal layout flow. The image viewport trims unused space so the slider follows the displayed image immediately. It never overlays image pixels. The background is solid, without a striped pattern. There are no branding, filename, or bottom information panels. Counts are not displayed. Adjusting sensitivity refreshes detection while retaining the nearest remaining line.

Choose **Fix** to repair the selected stripe, including any detected color bleed around it. The selection remains exactly one pixel row; the repair can cover several rows when the defect extends beyond its center. The repair range remains available to screen readers without a visible information panel. Clean reference rows are chosen outside that range, and only pixels within the reported strip are changed. This prevents JPEG halos from being copied into the repair.

Detection considers brightness and color differences so tinted residue can be detected even when it has little brightness contrast. The repair expands through coherent neighboring color contamination, up to six rows beyond each detected edge. It uses stable image columns to distinguish bleed from texture; preview the result on detailed areas.

Fixed rows are excluded from subsequent detection until the edit is undone or the image is reloaded. **Ctrl/Cmd+Z** restores the complete previous image, selection, and sensitivity. When no candidate rows remain, the preview shows the whole image normally and line navigation is disabled.

**Save** exports the cleaned image at its working dimensions, without magnification or highlights. Large input images are reduced to the existing processing limits (2,600 pixels per dimension and 12 megapixels). Processing stays local in the browser; no upload or server is required.

Detection is designed for thin, straight light or dark horizontal stripes across a substantial part of the image, including multi-pixel bands. Vertical, short, curved, or diagonal marks are not supported. Preview the repair before applying it; interpolation can soften detailed areas.

## Checks

Run `node --check app.js` and `node --test tests/app.test.cjs` (Node.js 18+). The dependency-free tests cover horizontal-only detection and cleanup, zero/one/many selections, directional navigation boundaries, pixel-distance fisheye magnification and rendering, responsive highlight mapping, sensitivity changes, Undo, Reset, JPEG color-bleed repair, preservation outside the repair strip, repair preview/apply equivalence, and clean PNG export. They do not replace testing with real photographs in a browser.

## Install on Android

Open https://untamo.github.io/image-fix/ in Chrome itself (use **Open in Chrome** if another app opened the link). In Chrome's three-dot menu, choose **Install and create shortcut → Install**; some versions call this **Add to Home screen → Install**. Confirm the browser's prompt. LineLift then opens from its own icon in a standalone window. The browser may also offer installation automatically; installation always needs your confirmation.

After the first online load finishes caching, the app can reopen and process images offline. The offline cache contains only app files. Shared photos use a separate temporary local handoff and are deleted after the editor receives them; abandoned handoffs expire after five minutes and are cleared on the next app load or share. Unsaved edits remain in the current session. Save before closing. Updates download online and become active after all LineLift tabs and app windows are closed and reopened.

The manifest and service worker are scoped to this repository's directory. For every release, bump `VERSION` and asset URLs in `sw.js` along with the matching URLs in `index.html`. Keep `sw.js` at its stable path. Run `node --test tests/*.test.cjs` to include offline caching and manifest checks.

## Share a photo into LineLift

In Android Gallery, Photos, or Files, select one image, tap **Share**, then choose **LineLift**. The image opens directly in the editor. This needs a browser installation that supports Web Share Target. Existing installations may need a manifest update before Android lists the new target; if it does not appear after updating, save your work and reinstall the app. If an Edge installation does not register the target, try installing through Chrome.

The share request is intercepted locally by the service worker, including when offline; it is never forwarded to GitHub Pages. One image up to 20 MB is accepted. Each handoff has a unique identifier so separate shares cannot overwrite one another. Multiple files, non-images, expired handoffs, and storage failures show an error with the normal image picker available.
