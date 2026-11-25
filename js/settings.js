/* Settings: theme (System / Light / Dark) and chart/editor colors, saved in this browser.
   Colors are CSS variables (see style.css); a custom color is set on <html> and kept per
   theme, so changing the dark theme's chord color doesn't change the light theme's. */
var AppSettings = (function () {
  "use strict";

  var THEME_KEY = "chordpro-editor-theme";
  var COLORS_KEY = "chordpro-editor-colors";
  var COLORS = [
    { v: "--title", label: "Title", group: "Header" },
    { v: "--subtitle", label: "Subtitle", group: "Header" },
    { v: "--meta", label: "Details (artist, key, tempo...)", group: "Header" },
    { v: "--meta-label", label: "Detail labels", group: "Header" },
    { v: "--capo-bg", label: "Capo pill", group: "Header" },
    { v: "--capo-text", label: "Capo pill text", group: "Header" },
    { v: "--diagram-dot", label: "Dots", group: "Chord diagrams" },
    { v: "--diagram-line", label: "Grid lines", group: "Chord diagrams" },
    { v: "--diagram-name", label: "Chord names and open strings", group: "Chord diagrams" },
    { v: "--strip-bg", label: "Box behind the diagrams", group: "Chord diagrams" },
    { v: "--lyric", label: "Lyrics", group: "Chart" },
    { v: "--chord", label: "Chords", group: "Chart" },
    { v: "--section", label: "Section labels", group: "Chart" },
    { v: "--comment", label: "Comments", group: "Chart" },
    { v: "--sheet-bg", label: "Chart background", group: "Chart" },
    { v: "--editor-text", label: "Editor text", group: "Editor" },
    { v: "--editor-bg", label: "Editor background", group: "Editor" }
  ];
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function store(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }

  var theme = load(THEME_KEY, "system");
  var custom;
  try { custom = JSON.parse(load(COLORS_KEY, "{}")) || {}; } catch (e) { custom = {}; }
  custom.dark = custom.dark || {};
  custom.light = custom.light || {};

  // The theme actually showing: "light" or "dark".
  function effectiveTheme() {
    if (theme === "light" || theme === "dark") return theme;
    return media && media.matches ? "light" : "dark";
  }

  function apply() {
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    COLORS.forEach(function (c) { root.style.removeProperty(c.v); });
    var mine = custom[effectiveTheme()];
    Object.keys(mine).forEach(function (v) { root.style.setProperty(v, mine[v]); });
  }

  // CSS for exports (PDF / HTML): they always use the Light theme's colors, whichever theme is
  // on screen - starting from the print defaults, with any Light colors you've picked on top.
  var EXPORT_VARS = ["--title", "--subtitle", "--meta", "--meta-label", "--capo-bg", "--capo-text",
    "--diagram-dot", "--diagram-line", "--diagram-name", "--strip-bg",
    "--lyric", "--chord", "--section", "--comment", "--sheet-bg"];
  function exportCss() {
    var light = custom.light;
    var rules = EXPORT_VARS.filter(function (v) { return light[v]; })
      .map(function (v) { return v + ": " + light[v] + ";"; });
    return rules.length ? ":root { " + rules.join(" ") + " }" : "";
  }

  // ---------- panel ----------
  var overlay, themeSel, colorBox, colorTitle;

  function toHex(value) {
    value = (value || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(value)) return value;
    if (/^#[0-9a-f]{3}$/i.test(value)) return "#" + value.slice(1).replace(/./g, "$&$&");
    return "#000000";
  }

  function fillColors() {
    var eff = effectiveTheme();
    colorTitle.textContent = "Colors (" + eff + " theme)";
    var cs = getComputedStyle(root);
    colorBox.innerHTML = "";
    var lastGroup = null;
    COLORS.forEach(function (c) {
      var group = c.group || "Chart";
      if (group !== lastGroup) {
        var h = document.createElement("div");
        h.className = "settings-group";
        h.textContent = group;
        colorBox.appendChild(h);
        lastGroup = group;
      }
      var row = document.createElement("label");
      row.className = "settings-row";
      row.textContent = c.label;
      var input = document.createElement("input");
      input.type = "color";
      input.value = toHex(cs.getPropertyValue(c.v));
      input.addEventListener("input", function () {
        custom[eff][c.v] = input.value;
        root.style.setProperty(c.v, input.value);
        store(COLORS_KEY, JSON.stringify(custom));
      });
      row.appendChild(input);
      colorBox.appendChild(row);
    });
  }

  function open() { themeSel.value = theme; fillColors(); overlay.classList.add("open"); }
  function close() { overlay.classList.remove("open"); }

  function init() {
    overlay = document.getElementById("settingsOverlay");
    themeSel = document.getElementById("themeSelect");
    colorBox = document.getElementById("settingsColors");
    colorTitle = document.getElementById("settingsColorsTitle");
    document.getElementById("settingsBtn").addEventListener("click", open);
    document.getElementById("settingsCloseBtn").addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && overlay.classList.contains("open")) close(); });
    themeSel.addEventListener("change", function () {
      theme = themeSel.value;
      store(THEME_KEY, theme);
      apply();
      fillColors();
    });
    document.getElementById("resetColorsBtn").addEventListener("click", function () {
      custom[effectiveTheme()] = {};
      store(COLORS_KEY, JSON.stringify(custom));
      apply();
      fillColors();
    });
    // "System" follows the computer switching between light and dark mode
    if (media) {
      var onChange = function () { if (theme === "system") { apply(); if (overlay.classList.contains("open")) fillColors(); } };
      if (media.addEventListener) media.addEventListener("change", onChange); else if (media.addListener) media.addListener(onChange);
    }
  }

  apply(); // as early as possible, so the page doesn't flash the wrong theme
  return { init: init, exportCss: exportCss, effectiveTheme: effectiveTheme };
})();
