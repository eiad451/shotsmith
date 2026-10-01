/**
 * Theme bootstrap — deliberately a classic, render-blocking script in <head>.
 *
 * Two jobs, both of which must happen before the first paint:
 *  1. Resolve the stored preference into `data-theme` so a dark-mode visitor
 *     never sees a white flash while app.js (a deferred module) boots.
 *  2. Point the single <meta name="theme-color"> at the effective background,
 *     which is what colours the mobile browser chrome.
 *
 * It is a separate file rather than an inline <script> because the page ships a
 * strict Content-Security-Policy with no 'unsafe-inline'.
 */
(function bootstrapTheme() {
  var LIGHT = "#f1f1f2";
  var DARK = "#131314";

  function paint(dark) {
    var meta = document.getElementById("themeColor");
    if (meta) meta.setAttribute("content", dark ? DARK : LIGHT);
  }

  try {
    var stored = JSON.parse(localStorage.getItem("shotsmith.prefs.v1") || "{}");
    var theme = stored && stored.theme;
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
      paint(theme === "dark");
      return;
    }
  } catch (error) {
    /* corrupt or blocked storage: fall through to the OS preference */
  }

  paint(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
})();