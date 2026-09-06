# LineLift

LineLift is a browser-only image editor for detecting and removing distracting vertical or horizontal lines.

## Use it

Open `index.html` in a modern browser, drop in an image, choose **Vertical**, **Horizontal**, or **Both**, review the highlighted guides, and choose **Remove detected lines**. The cleaned image can be downloaded as a PNG.

The controls float over the image preview on desktop and mobile. Direction and sensitivity update the highlighted guides immediately. Use **Hide controls** for an unobstructed view or **Move controls to top/bottom** to uncover the area you are inspecting. The panel scrolls on smaller screens, and Undo and Reset remain available on phones.

The editor processes the image locally in the browser. No upload or server is required.

The direction selection immediately refreshes detection on the current edited image. Vertical guides are green; horizontal guides are blue. High-contrast guides stay visible when the image is scaled down and are never included in the downloaded PNG.

Detection is designed for thin, straight light or dark stripes across a substantial part of the image, including multi-pixel bands. It is not general-purpose object removal: short, curved, or diagonal marks may not be detected. Review the highlights before removing; interpolation can soften detailed areas. Use Undo to restore the previous image and its direction settings.

## Checks

Run `node --check app.js` and `node --test tests/app.test.cjs` (Node.js 18+). The dependency-free tests cover direction changes, both detection axes, thick and faint lines, cleanup, Undo, responsive highlight coordinates, and PNG export. They do not replace testing with real photographs in a browser.

