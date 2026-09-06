// Installation uses the browser's own menu/prompt, keeping the editor minimal.
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" })
      .catch((error) => console.warn("Offline support is unavailable:", error));
  });
}

async function openSharedImage() {
  const url = new URL(window.location.href);
  const scope = new URL("./", url).href;
  const id = url.searchParams.get("shared");
  const error = url.searchParams.get("share-error");
  const messages = {
    count: "Share one image at a time with LineLift.",
    type: "Please share an image file with LineLift.",
    size: "That image is larger than 20 MB. Choose a smaller file.",
    unavailable: "The shared image could not be received. Try sharing it again or choose it here.",
  };
  // Refresh must not attempt to import a previously consumed image again.
  if (id || error) {
    url.searchParams.delete("shared");
    url.searchParams.delete("share-error");
    window.history.replaceState(null, "", url.href);
  }
  try {
    if (error) setError(messages[error] || messages.unavailable);
    else if (id) {
      const file = await sharedImages.take(scope, id);
      if (file) loadImageFile(file);
      else setError("The shared image has expired. Please share it again.");
    }
    if ("caches" in window) await sharedImages.prune(scope);
  } catch {
    if (id || error) setError(messages.unavailable);
  }
  if ((id || error) && elements.errorNotice.textContent) {
    elements.errorNotice.scrollIntoView({ block: "center" });
  }
}
window.addEventListener("load", openSharedImage);
