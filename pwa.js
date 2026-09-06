// Installation uses the browser's own menu/prompt, keeping the editor minimal.
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" })
      .catch((error) => console.warn("Offline support is unavailable:", error));
  });
}
