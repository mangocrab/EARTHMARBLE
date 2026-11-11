/* Earth Marble: place this script on your site and call EarthMarble.mount(). */
(() => {
  const script = document.currentScript;
  const defaultURL = new URL("./", script.src).href;
  function mount(target, options = {}) {
    const container =
      typeof target === "string" ? document.querySelector(target) : target;
    if (!(container instanceof Element))
      throw new Error("EarthMarble.mount: container not found");
    const url = new URL(options.url || defaultURL, location.href);
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("EarthMarble.mount: use an http(s) game URL");
    const iframe = document.createElement("iframe");
    iframe.src = url.href;
    iframe.title = options.title || "지구마블 온라인 보드게임";
    iframe.allow = "autoplay; fullscreen";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.style.cssText = "display:block;width:100%;border:0;";
    iframe.style.height = options.height || "100dvh";
    container.append(iframe);
    return Object.freeze({ iframe, destroy: () => iframe.remove() });
  }
  window.EarthMarble = Object.freeze({ mount });
})();
