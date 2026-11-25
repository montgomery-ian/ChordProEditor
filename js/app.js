(function () {
  "use strict";

  var editor = document.getElementById("editor");
  var preview = document.getElementById("preview");
  var fileNameLabel = document.getElementById("fileNameLabel");
  var statusLeft = document.getElementById("statusLeft");
  var statusRight = document.getElementById("statusRight");

  var SAMPLE = [
    "{title: Amazing Grace}",
    "{subtitle: Traditional}",
    "{artist: John Newton}",
    "{key: G}",
    "{time: 3/4}",
    "{capo: 0}",
    "",
    "{comment: Verse 1}",
    "{start_of_verse}",
    "[G]Amazing [G7]grace, how [C]sweet the [G]sound",
    "That [G]saved a [Em]wretch like [D]me",
    "I [G]once was [G7]lost but [C]now am [G]found",
    "Was [Em]blind but [D]now I [G]see",
    "{end_of_verse}",
    "",
    "{start_of_chorus}",
    "[C]How [G]precious [D]did that [G]grace appear",
    "The [Em]hour I [D]first be[G]lieved",
    "{end_of_chorus}",
    "",
    "{comment: Verse 2}",
    "{start_of_verse}",
    "[G]'Twas [G7]grace that [C]taught my [G]heart to fear",
    "And [G]grace my [Em]fears re[D]lieved",
    "{end_of_verse}",
    "",
    "{chorus}",
    "",
    "{start_of_tab}",
    "e|---0----0----1----0---|",
    "B|---0----0----0----3---|",
    "G|---0----0----0----0---|",
    "{end_of_tab}"
  ].join("\n");

  var STORAGE_KEY = "chordpro-editor-source";
  var fileHandle = null;
  var currentFileName = "untitled.cho";

  function loadInitial() {
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    editor.value = saved != null && saved !== "" ? saved : SAMPLE;
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      var args = arguments;
      t = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  }

  function currentOpts() {
    return {
      transpose: parseInt(document.getElementById("transposeSteps").value, 10) || 0,
      useFlats: document.getElementById("useFlats").checked,
      // numbers have no fixed letter names, so no diagrams in Nashville / Roman style
      showDiagrams: document.getElementById("showDiagramsToggle").checked && document.getElementById("notationSelect").value === "traditional",
      notation: document.getElementById("notationSelect").value,
      minorMark: document.getElementById("minorMarkSelect").value
    };
  }

  function resolveInstrument(ast) {
    var picked = document.getElementById("instrumentSelect").value;
    if (ChordInstruments.DEFS[picked]) return { instrument: picked, auto: false };
    var detected = ChordInstruments.detectFromAst(ast.children);
    return { instrument: detected || "guitar", auto: true, detected: !!detected };
  }

  function renderNow() {
    var src = editor.value;
    var instrumentBadge = document.getElementById("instrumentStatus");
    try {
      var ast = ChordProParser.parse(src);
      var resolved = resolveInstrument(ast);
      var opts = currentOpts();
      opts.instrument = resolved.instrument;
      var html = ChordProRenderer.render(ast, opts);
      preview.innerHTML = html;
      if (typeof syncScroll !== "undefined" && syncScroll) syncScroll.afterRender();
      statusLeft.textContent = "Ready";
      instrumentBadge.textContent = resolved.auto
        ? (resolved.detected ? "auto: " + ChordInstruments.DEFS[resolved.instrument].label : "auto: Guitar (default)")
        : "";
      var capoSelect = document.getElementById("capoSelect");
      var capoInSource = String(Math.max(0, Math.min(11, readCapoFromSource(src))));
      if (capoSelect.value !== capoInSource && document.activeElement !== capoSelect) capoSelect.value = capoInSource;
    } catch (err) {
      statusLeft.textContent = "Parse error: " + err.message;
    }
    try { localStorage.setItem(STORAGE_KEY, src); } catch (e) {}
    updateStatusRight();
    updateUndoRedoButtons();
  }

  var renderDebounced = debounce(renderNow, 150);

  function updateStatusRight() {
    var text = editor.value;
    var pos = editor.selectionStart;
    var upto = text.slice(0, pos);
    var line = upto.split("\n").length;
    var col = pos - upto.lastIndexOf("\n");
    statusRight.textContent = "Line " + line + ", Col " + col + " · " + text.length + " chars";
  }

  editor.addEventListener("input", renderDebounced);
  editor.addEventListener("click", updateStatusRight);
  editor.addEventListener("keyup", updateStatusRight);

  editor.addEventListener("keydown", function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
    if (mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); redo(); return; }
    if (e.key === "Tab") {
      e.preventDefault();
      recordUndoPoint();
      var start = editor.selectionStart, end = editor.selectionEnd;
      if (e.shiftKey) {
        var lineStart = editor.value.lastIndexOf("\n", start - 1) + 1;
        if (editor.value.slice(lineStart, lineStart + 2) === "  ") {
          editor.value = editor.value.slice(0, lineStart) + editor.value.slice(lineStart + 2);
          editor.selectionStart = Math.max(lineStart, start - 2);
          editor.selectionEnd = Math.max(lineStart, end - 2);
        }
      } else {
        editor.value = editor.value.slice(0, start) + "  " + editor.value.slice(end);
        editor.selectionStart = editor.selectionEnd = start + 2;
      }
      renderDebounced();
    }
  });

  // ---------- Undo / Redo ----------
  // The textarea's own undo history breaks every time we set .value from script (directive
  // insert, dictation, docx import, Tab indent, Open/New) - so we keep an independent stack.
  var undoStack = [];
  var redoStack = [];
  var lastInputType = null;
  var lastSnapshotTime = 0;
  var COALESCE_MS = 600;

  function snapshot() {
    return { value: editor.value, start: editor.selectionStart, end: editor.selectionEnd };
  }

  function recordUndoPoint() {
    var snap = snapshot();
    var top = undoStack[undoStack.length - 1];
    if (top && top.value === snap.value) return;
    undoStack.push(snap);
    if (undoStack.length > 500) undoStack.shift();
    redoStack.length = 0;
    updateUndoRedoButtons();
  }

  function restoreSnapshot(snap) {
    editor.value = snap.value;
    editor.selectionStart = snap.start;
    editor.selectionEnd = snap.end;
    renderNow();
    editor.focus();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restoreSnapshot(undoStack.pop());
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restoreSnapshot(redoStack.pop());
  }

  function updateUndoRedoButtons() {
    document.getElementById("undoBtn").disabled = undoStack.length === 0;
    document.getElementById("redoBtn").disabled = redoStack.length === 0;
  }

  // Captures the pre-edit state for real keystrokes/paste/cut, coalesced so rapid typing
  // doesn't create an undo step per character.
  editor.addEventListener("beforeinput", function (e) {
    var now = Date.now();
    var type = e.inputType || "";
    var boundary = type !== lastInputType || (now - lastSnapshotTime) > COALESCE_MS;
    if (boundary) recordUndoPoint();
    lastInputType = type;
    lastSnapshotTime = now;
  });

  document.getElementById("undoBtn").addEventListener("click", undo);
  document.getElementById("redoBtn").addEventListener("click", redo);

  function insertAtCursor(text) {
    recordUndoPoint();
    var start = editor.selectionStart, end = editor.selectionEnd;
    editor.value = editor.value.slice(0, start) + text + editor.value.slice(end);
    editor.selectionStart = editor.selectionEnd = start + text.length;
    editor.focus();
    renderNow();
  }

  // ---------- Toolbar: new / insert chord ----------
  document.getElementById("newBtn").addEventListener("click", function () {
    if (editor.value.trim() && !confirm("Start a new song? Unsaved changes will be lost.")) return;
    recordUndoPoint();
    editor.value = "{title: }\n{artist: }\n{key: }\n\n";
    fileHandle = null;
    savedValue = editor.value;
    setFileName("untitled.cho");
    renderNow();
    editor.focus();
  });

  document.getElementById("insertChordBtn").addEventListener("click", function () {
    recordUndoPoint();
    var start = editor.selectionStart, end = editor.selectionEnd;
    var sel = editor.value.slice(start, end);
    var replacement = sel ? "[" + sel + "]" : "[C]";
    editor.value = editor.value.slice(0, start) + replacement + editor.value.slice(end);
    editor.selectionStart = start + 1;
    editor.selectionEnd = start + replacement.length - 1;
    editor.focus();
    renderNow();
  });

  // ---------- Directive insert dropdown + reference modal ----------
  function populateDirectiveUI() {
    var select = document.getElementById("insertDirectiveSelect");
    var categories = {};
    ChordProDirectives.TABLE.forEach(function (d) {
      (categories[d.category] = categories[d.category] || []).push(d);
    });
    var CAT_LABEL = { meta: "Metadata", format: "Formatting", env: "Sections", delegated: "Delegated blocks", chord: "Chords", layout: "Layout", legacy: "Legacy (print only)" };
    Object.keys(CAT_LABEL).forEach(function (cat) {
      if (!categories[cat]) return;
      var group = document.createElement("optgroup");
      group.label = CAT_LABEL[cat];
      categories[cat].forEach(function (d) {
        var opt = document.createElement("option");
        opt.value = d.snippet;
        opt.textContent = "{" + d.name + "}" + (d.aliases.length ? " (" + d.aliases.join(",") + ")" : "");
        group.appendChild(opt);
      });
      select.appendChild(group);
    });
    select.addEventListener("change", function () {
      if (select.value) { insertAtCursor(select.value); select.value = ""; }
    });

    var refTable = document.getElementById("refTable");
    Object.keys(CAT_LABEL).forEach(function (cat) {
      if (!categories[cat]) return;
      var headRow = document.createElement("tr");
      headRow.className = "cat-heading";
      headRow.innerHTML = "<td colspan=2>" + CAT_LABEL[cat] + "</td>";
      refTable.appendChild(headRow);
      categories[cat].forEach(function (d) {
        var row = document.createElement("tr");
        var aliasText = d.aliases.length ? " / " + d.aliases.map(function (a) { return "{" + a + "}"; }).join(" ") : "";
        row.innerHTML = '<td><code>{' + d.name + "}" + aliasText + "</code></td><td>" + d.desc + "</td>";
        row.querySelector("code").addEventListener("click", function () { insertAtCursor(d.snippet); closeRef(); });
        refTable.appendChild(row);
      });
    });
  }

  function openRef() { document.getElementById("refOverlay").classList.add("open"); }
  function closeRef() { document.getElementById("refOverlay").classList.remove("open"); }
  document.getElementById("refBtn").addEventListener("click", openRef);
  document.getElementById("refClose").addEventListener("click", closeRef);
  document.getElementById("refOverlay").addEventListener("click", function (e) { if (e.target.id === "refOverlay") closeRef(); });

  // ---------- Transpose / flats / font size ----------
  var TRANSPOSE_LIMIT = 11; // beyond ±11 semitones you're just back to another octave of the same pitch class
  function clampTranspose(n) { return Math.max(-TRANSPOSE_LIMIT, Math.min(TRANSPOSE_LIMIT, n)); }

  document.getElementById("transUp").addEventListener("click", function () {
    var inp = document.getElementById("transposeSteps");
    inp.value = clampTranspose((parseInt(inp.value, 10) || 0) + 1);
    renderNow();
  });
  document.getElementById("transDown").addEventListener("click", function () {
    var inp = document.getElementById("transposeSteps");
    inp.value = clampTranspose((parseInt(inp.value, 10) || 0) - 1);
    renderNow();
  });
  document.getElementById("transposeSteps").addEventListener("change", function (e) {
    e.target.value = clampTranspose(parseInt(e.target.value, 10) || 0);
    renderNow();
  });
  document.getElementById("useFlats").addEventListener("change", renderNow);

  // Chord notation (traditional / Nashville / Roman), remembered between visits.
  (function setupNotation() {
    var sel = document.getElementById("notationSelect");
    var minorSel = document.getElementById("minorMarkSelect");
    var minorWrap = document.getElementById("minorMarkWrap");
    try { var saved = localStorage.getItem("chordpro-editor-notation"); if (saved && sel.querySelector('option[value="' + saved + '"]')) sel.value = saved; } catch (e) {}
    try { var savedMinor = localStorage.getItem("chordpro-editor-minor-mark"); if (savedMinor === "-" || savedMinor === "m") minorSel.value = savedMinor; } catch (e) {}
    // The minor-chord choice (6m or 6-) only applies to Nashville numbers, so it shows only then.
    // Transpose, flats, capo and diagrams only mean something with letter names, so in Nashville /
    // Roman style they're greyed out (their settings are kept for when you switch back).
    function syncMinorWrap() {
      minorWrap.hidden = sel.value !== "nashville";
      var numbers = sel.value !== "traditional";
      Array.prototype.forEach.call(document.querySelectorAll("#chartToolbar .letters-only"), function (group) {
        group.classList.toggle("is-disabled", numbers);
        group.title = numbers ? "Not used with " + (sel.value === "roman" ? "Roman numerals" : "Nashville numbers") + " - switch Chord Style to Traditional" : "";
        Array.prototype.forEach.call(group.querySelectorAll("input, select, button"), function (el) { el.disabled = numbers; });
      });
    }
    syncMinorWrap();
    sel.addEventListener("change", function () {
      try { localStorage.setItem("chordpro-editor-notation", sel.value); } catch (e) {}
      syncMinorWrap();
      renderNow();
    });
    minorSel.addEventListener("change", function () {
      try { localStorage.setItem("chordpro-editor-minor-mark", minorSel.value); } catch (e) {}
      renderNow();
    });
  })();
  // ---------- Font sizes (chart and editor, each remembered between visits) ----------
  // The chart's CSS sizes everything in em off #preview, so this one value scales the whole chart.
  function setupFontSize(inputId, storageKey, apply) {
    var input = document.getElementById(inputId);
    var min = parseInt(input.min, 10), max = parseInt(input.max, 10);
    function clamp(v) { return Math.max(min, Math.min(max, v)); }
    var saved = null;
    try { saved = parseInt(localStorage.getItem(storageKey), 10); } catch (e) {}
    if (saved && !isNaN(saved)) input.value = clamp(saved);
    apply(parseInt(input.value, 10));
    input.addEventListener("input", function () {
      var v = parseInt(input.value, 10);
      if (isNaN(v) || v < min || v > max) return; // mid-typing (e.g. "1" on the way to "18")
      apply(v);
      try { localStorage.setItem(storageKey, String(v)); } catch (e) {}
    });
    input.addEventListener("change", function () {
      var v = clamp(parseInt(input.value, 10) || parseInt(input.defaultValue, 10));
      input.value = v;
      apply(v);
      try { localStorage.setItem(storageKey, String(v)); } catch (e) {}
    });
  }
  setupFontSize("previewFontSize", "chordpro-editor-chart-font", function (v) { preview.style.fontSize = v + "px"; if (typeof syncScroll !== "undefined" && syncScroll) syncScroll.afterRender(); });
  setupFontSize("editorFontSize", "chordpro-editor-editor-font", function (v) { editor.style.fontSize = v + "px"; if (typeof syncScroll !== "undefined" && syncScroll) syncScroll.afterRender(); });
  document.getElementById("showDiagramsToggle").addEventListener("change", renderNow);
  document.getElementById("instrumentSelect").addEventListener("change", function () {
    // A capo setting is specific to the instrument it was dialed in on, so any instrument
    // change clears it - the capo dropdown itself stays usable either way.
    var capoSelect = document.getElementById("capoSelect");
    if (capoSelect.value !== "0") {
      recordUndoPoint();
      var start = editor.selectionStart, end = editor.selectionEnd;
      editor.value = upsertCapoDirective(editor.value, 0);
      editor.selectionStart = Math.min(start, editor.value.length);
      editor.selectionEnd = Math.min(end, editor.value.length);
      capoSelect.value = "0";
    }
    renderNow();
  });

  // ---------- Capo ----------
  // Writes/updates {capo: N} alongside the song's other header directives (source is the single
  // source of truth; the dropdown is a convenience that reads/writes it, same as a manual edit would).
  function upsertCapoDirective(src, capoValue) {
    var lines = src.split(/\r\n|\r|\n/);
    var capoLineRe = /^\s*\{\s*capo\s*[:\s][^}]*\}\s*$/i;
    var idx = -1;
    for (var k = 0; k < lines.length; k++) if (capoLineRe.test(lines[k])) { idx = k; break; }

    if (capoValue === 0) {
      if (idx !== -1) lines.splice(idx, 1);
      return lines.join("\n");
    }
    var newLine = "{capo: " + capoValue + "}";
    if (idx !== -1) { lines[idx] = newLine; return lines.join("\n"); }

    var directiveLineRe = /^\s*\{[^}]*\}\s*$/;
    var insertAt = 0;
    for (var i = 0; i < lines.length; i++) {
      if (directiveLineRe.test(lines[i]) || lines[i].trim() === "") insertAt = i + 1;
      else break;
    }
    lines.splice(insertAt, 0, newLine);
    return lines.join("\n");
  }

  function readCapoFromSource(src) {
    var m = /\{\s*capo\s*[:\s]\s*(-?\d+)/i.exec(src);
    return m ? parseInt(m[1], 10) : 0;
  }

  document.getElementById("capoSelect").addEventListener("change", function (e) {
    recordUndoPoint();
    var n = parseInt(e.target.value, 10) || 0;
    var start = editor.selectionStart, end = editor.selectionEnd;
    editor.value = upsertCapoDirective(editor.value, n);
    editor.selectionStart = Math.min(start, editor.value.length);
    editor.selectionEnd = Math.min(end, editor.value.length);
    renderNow();
  });

  // ---------- Save / Open (File System Access API with download fallback) ----------
  function setFileName(name) {
    currentFileName = name;
    fileNameLabel.textContent = name;
  }

  function downloadFallback(text, filename, mime) {
    var blob = new Blob([text], { type: (mime || "text/plain") + ";charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  // What was last saved or opened, so an import only asks to save when there are real changes.
  var savedValue = null;
  function hasUnsavedWork() { return editor.value.trim() !== "" && editor.value !== savedValue; }

  // Returns true once the song is written (or downloaded), false if the user cancelled.
  async function saveCurrent() {
    var text = editor.value;
    try {
      if (window.showSaveFilePicker) {
        if (!fileHandle) {
          fileHandle = await window.showSaveFilePicker({
            suggestedName: currentFileName,
            types: [{ description: "ChordPro file", accept: { "text/plain": [".cho", ".crd", ".chopro", ".txt"] } }]
          });
          setFileName(fileHandle.name);
        }
        var writable = await fileHandle.createWritable();
        await writable.write(text);
        await writable.close();
        statusLeft.textContent = "Saved " + fileHandle.name + " at " + new Date().toLocaleTimeString();
      } else {
        downloadFallback(text, currentFileName);
        statusLeft.textContent = "Downloaded " + currentFileName;
      }
      savedValue = text;
      return true;
    } catch (err) {
      if (err && err.name !== "AbortError") {
        downloadFallback(text, currentFileName);
        savedValue = text;
        return true;
      }
      return false;
    }
  }

  document.getElementById("saveBtn").addEventListener("click", saveCurrent);

  document.getElementById("openBtn").addEventListener("click", async function () {
    try {
      if (window.showOpenFilePicker) {
        var handles = await window.showOpenFilePicker({
          types: [{ description: "ChordPro file", accept: { "text/plain": [".cho", ".crd", ".chopro", ".chordpro", ".txt"] } }]
        });
        fileHandle = handles[0];
        var file = await fileHandle.getFile();
        recordUndoPoint();
        editor.value = await file.text();
        savedValue = editor.value;
        setFileName(file.name);
        renderNow();
      } else {
        document.getElementById("fileInput").click();
      }
    } catch (err) {
      if (err && err.name !== "AbortError") document.getElementById("fileInput").click();
    }
  });

  document.getElementById("fileInput").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    fileHandle = null;
    var reader = new FileReader();
    reader.onload = function () {
      recordUndoPoint();
      editor.value = reader.result;
      savedValue = editor.value;
      setFileName(file.name);
      renderNow();
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  // ---------- Export (HTML / PDF) ----------
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function exportBaseName() {
    var titleEl = preview.querySelector(".meta-title");
    var name = (titleEl ? titleEl.textContent : currentFileName.replace(/\.[^.]+$/, "")).trim();
    name = name.replace(/[\\/:*?"<>|]+/g, "") || "chord-chart";
    return name;
  }

  // Exports use the shared chart styles (ChartStyle) in a light, print-friendly theme. Reading
  // style.css's rules doesn't work when the app is opened from disk, which is why exports used
  // to come out unstyled.
  function buildStandaloneChartHtml() {
    return "<!DOCTYPE html>\n<html><head><meta charset=\"UTF-8\">" +
      "<title>" + escHtml(exportBaseName()) + "</title>" +
      "<style>" + ChartStyle.CSS + "\n" + ChartStyle.PAPER_CSS + "\n" + AppSettings.exportCss() + "</style>" +
      "</head><body><div id=\"preview\" style=\"font-size:" + escHtml(preview.style.fontSize || "15px") + "\">" + preview.innerHTML + "</div></body></html>";
  }

  document.getElementById("exportHtmlBtn").addEventListener("click", function () {
    var html = buildStandaloneChartHtml();
    downloadFallback(html, exportBaseName() + ".html", "text/html");
    statusLeft.textContent = "Exported " + exportBaseName() + ".html";
  });

  // Printed from a hidden iframe rather than a new window/tab - this needs no pop-up permission
  // and can't be blocked, since nothing ever leaves the current page.
  document.getElementById("exportPdfBtn").addEventListener("click", function () {
    var html = buildStandaloneChartHtml();
    var iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(iframe);
    // The browser suggests the PDF's file name from the page title (the app's, even when printing
    // the iframe), so it's set to the song name while the print dialog is open.
    var appTitle = document.title;
    var cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      document.title = appTitle;
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }
    iframe.onload = function () {
      var win = iframe.contentWindow;
      win.addEventListener("afterprint", cleanup);
      document.title = exportBaseName();
      win.focus();
      win.print();
      setTimeout(cleanup, 60000); // safety net in case afterprint never fires
    };
    iframe.srcdoc = html;
    statusLeft.textContent = "Opened the print dialog - choose \"Save as PDF\" as the destination.";
  });

  // ---------- docx / pdf import ----------
  function insertConvertedImport(rawText, file) {
    var converted = ChordAboveLyrics.convert(rawText);
    var insertion = converted.text.replace(/\n+$/, "") + "\n";
    // A key in the file name ("Abide - Ab.pdf", "Song (Key of G).docx") when the chart itself has none
    var baseName = file.name.replace(/\.[^.]+$/, "");
    var keyInName = /(?:\s[-–]\s*|\(\s*(?:key\s*(?:of)?\s*)?|\bkey\s*(?:of)?\s*)([A-G][#b]?m?)\s*\)?\s*$/i.exec(baseName);
    if (keyInName && !/^\s*\{\s*key\s*:/im.test(insertion)) {
      var keyName = keyInName[1].charAt(0).toUpperCase() + keyInName[1].slice(1);
      var lines = insertion.split("\n");
      var at = 0;
      while (at < lines.length && /^\s*\{\s*(title|subtitle|artist|composer)\s*:/i.test(lines[at])) at++;
      lines.splice(at, 0, "{key: " + keyName + "}");
      insertion = lines.join("\n");
    }
    // Every import becomes its own new song (the previous one was offered a save first), named
    // after the imported file: song.docx -> song.cho. Undo brings the previous song back.
    recordUndoPoint();
    editor.value = insertion;
    editor.selectionStart = editor.selectionEnd = 0;
    editor.scrollTop = 0;
    fileHandle = null;
    savedValue = null;
    setFileName((file.name.replace(/\.[^.]+$/, "").trim() || "untitled") + ".cho");
    renderNow();
    var chordNote = (converted.mergedCount || converted.standaloneCount)
      ? " — matched chords to lyrics on " + converted.mergedCount + " line(s), " + converted.standaloneCount + " chord-only line(s) kept as-is."
      : " — no chord-above-lyric lines detected; imported as plain text.";
    statusLeft.textContent = "Imported " + file.name + " as a new song, " + currentFileName + chordNote;
  }

  // One Import button for .docx and .pdf. The file is picked first (straight from the button
  // click, so the browser always allows the picker), then unsaved work is offered a save, then the
  // file opens as a new song. The input is cleared before every pick, so choosing the same file
  // again - or trying again after a failed import - always fires.
  var importInput = document.getElementById("importInput");
  var importOverlay = document.getElementById("importOverlay");
  var pendingImportFile = null;   // the file waiting on the Save / Don't save answer
  var pendingImportHandle = null; // a dropped .cho file's handle (Chrome/Edge), so Save writes back to it
  var CHORDPRO_EXT_RE = /\.(cho|crd|chopro|chordpro|pro|txt)$/i;
  var IMPORT_EXT_RE = /\.(docx|pdf)$/i;

  function closeImportDialog() { importOverlay.classList.remove("open"); }

  document.getElementById("importBtn").addEventListener("click", function () {
    importInput.value = "";
    importInput.click();
  });

  importInput.addEventListener("change", function () {
    var file = importInput.files && importInput.files[0];
    importInput.value = "";
    if (!file) return;
    if (!IMPORT_EXT_RE.test(file.name)) {
      statusLeft.textContent = "Import works with .docx and .pdf files only - " + file.name + " was not imported.";
      return;
    }
    openIncoming(file, null);
  });

  // Shared by the Import button and drag-and-drop: offer a save if needed, then open the file.
  function openIncoming(file, handle) {
    if (!hasUnsavedWork()) { finishOpen(file, handle); return; }
    pendingImportFile = file;
    pendingImportHandle = handle;
    document.getElementById("importAskName").textContent = currentFileName;
    document.getElementById("importAskFile").textContent = file.name;
    importOverlay.classList.add("open");
    document.getElementById("importSaveBtn").focus();
  }

  function finishOpen(file, handle) {
    pendingImportFile = pendingImportHandle = null;
    if (IMPORT_EXT_RE.test(file.name)) runImport(file);
    else openChordProFile(file, handle);
  }

  function openChordProFile(file, handle) {
    file.text().then(function (text) {
      recordUndoPoint();
      editor.value = text;
      editor.selectionStart = editor.selectionEnd = 0;
      editor.scrollTop = 0;
      savedValue = text;
      fileHandle = handle || null; // with a handle, Save writes straight back to this file
      setFileName(file.name);
      renderNow();
      statusLeft.textContent = "Opened " + file.name + (handle ? " - Save writes back to this file." : ".");
    }).catch(function (err) {
      statusLeft.textContent = "Could not open " + file.name + ": " + (err && err.message ? err.message : err);
    });
  }

  document.getElementById("importSaveBtn").addEventListener("click", async function () {
    var file = pendingImportFile, handle = pendingImportHandle;
    closeImportDialog();
    await saveCurrent(); // a cancelled save still goes on to the import, as asked
    if (file) finishOpen(file, handle);
  });
  document.getElementById("importDontSaveBtn").addEventListener("click", function () {
    var file = pendingImportFile, handle = pendingImportHandle;
    closeImportDialog();
    if (file) finishOpen(file, handle);
  });

  // ---------- Drag and drop: a .docx, .pdf or .cho dropped anywhere on the app ----------
  (function setupDragDrop() {
    var app = document.getElementById("app");
    var depth = 0; // dragenter/dragleave fire for every child element; count them
    function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") !== -1; }
    function clear() { depth = 0; app.classList.remove("drop-target"); }

    window.addEventListener("dragenter", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      app.classList.add("drop-target");
    });
    window.addEventListener("dragover", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); // without this the browser would open the file itself
      e.dataTransfer.dropEffect = "copy";
    });
    window.addEventListener("dragleave", function (e) {
      if (!hasFiles(e)) return;
      if (--depth <= 0) clear();
    });
    window.addEventListener("drop", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      clear();
      var files = e.dataTransfer.files;
      if (!files || !files.length) return;
      var file = files[0];
      if (!IMPORT_EXT_RE.test(file.name) && !CHORDPRO_EXT_RE.test(file.name)) {
        statusLeft.textContent = file.name + " can't be opened here - drop a .docx, .pdf or .cho file.";
        return;
      }
      var note = files.length > 1 ? " (only the first of " + files.length + " files was used)" : "";
      // The handle has to be requested during the drop event itself, before any await.
      var item = e.dataTransfer.items && e.dataTransfer.items[0];
      var handlePromise = (CHORDPRO_EXT_RE.test(file.name) && item && item.getAsFileSystemHandle)
        ? item.getAsFileSystemHandle().catch(function () { return null; })
        : Promise.resolve(null);
      handlePromise.then(function (handle) {
        if (handle && handle.kind !== "file") handle = null;
        openIncoming(file, handle);
        if (note) statusLeft.textContent += note;
      });
    });
  })();
  // Esc or a click outside the box backs out without importing, so the dialog can never get stuck.
  importOverlay.addEventListener("click", function (e) { if (e.target === importOverlay) { pendingImportFile = null; closeImportDialog(); } });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && importOverlay.classList.contains("open")) { pendingImportFile = null; closeImportDialog(); }
  });

  function runImport(file) {
    pendingImportFile = null;
    var isPdf = /\.pdf$/i.test(file.name);
    if (isPdf ? typeof pdfjsLib === "undefined" : typeof mammoth === "undefined") {
      statusLeft.textContent = "Import failed: the " + (isPdf ? ".pdf" : ".docx") + " reader did not load (no internet connection?). Try again when online.";
      return;
    }
    statusLeft.textContent = "Importing " + file.name + "…";
    file.arrayBuffer().then(function (buffer) {
      return isPdf
        ? PdfChords.extractColumnText(buffer)
        : mammoth.convertToHtml({ arrayBuffer: buffer }, { ignoreEmptyParagraphs: false }).then(function (result) {
            return ChordAboveLyrics.docxHtmlToText(result.value);
          });
    }).then(function (text) {
      insertConvertedImport(text, file);
    }).catch(function (err) {
      statusLeft.textContent = "Import failed: " + (err && err.message ? err.message : err);
    });
  }

  // ---------- Dictation (Web Speech API) ----------
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recognition = null;
  var dictating = false;
  var dictateBtn = document.getElementById("dictateBtn");

  if (!SpeechRecognition) {
    dictateBtn.disabled = true;
    dictateBtn.title = "Speech recognition is not supported in this browser (try Chrome or Edge).";
  } else {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = function (event) {
      var finalChunk = "";
      var interim = "";
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalChunk += transcript;
        else interim += transcript;
      }
      if (finalChunk) {
        var text = finalChunk.trim();
        if (text) insertAtCursor(text.charAt(0).toUpperCase() + text.slice(1) + " ");
      }
      statusLeft.textContent = dictating ? ("Listening… " + interim) : "Ready";
    };

    recognition.onerror = function (event) {
      statusLeft.textContent = "Dictation error: " + event.error;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") stopDictation();
    };

    recognition.onend = function () {
      if (dictating) {
        try { recognition.start(); } catch (e) { stopDictation(); } // auto-restart (browsers stop after silence)
      }
    };

    function startDictation() {
      recognition.lang = document.getElementById("dictateLang").value;
      try { recognition.start(); } catch (e) {}
      dictating = true;
      dictateBtn.classList.add("recording");
      dictateBtn.textContent = "⏹ Stop";
      statusLeft.textContent = "Listening…";
      editor.focus();
    }

    function stopDictation() {
      dictating = false;
      try { recognition.stop(); } catch (e) {}
      dictateBtn.classList.remove("recording");
      dictateBtn.textContent = "🎤 Dictate";
      statusLeft.textContent = "Ready";
    }

    dictateBtn.addEventListener("click", function () {
      if (dictating) stopDictation(); else startDictation();
    });
  }

  // ---------- Split-pane resizer ----------
  // The toolbar's editor/chart split follows the pane divider; either handle can be dragged.
  (function setupDivider() {
    var split = document.getElementById("split");
    var editorPane = document.getElementById("editorPane");
    var editorToolbar = document.getElementById("editorToolbar");
    var chartToolbar = document.getElementById("chartToolbar");
    var previewPane = document.getElementById("previewPane");
    var app = document.getElementById("app");
    var dragging = false;

    function setSplit(pct) {
      var editorFlex = "0 0 " + (pct * 100) + "%";
      editorPane.style.flex = editorFlex;
      editorToolbar.style.flex = editorFlex;
      // chart side takes the rest on both rows, so the two handles stay lined up
      previewPane.style.flex = chartToolbar.style.flex = "1 1 0";
    }

    [document.getElementById("divider"), document.getElementById("toolbarDivider")].forEach(function (handle) {
      handle.addEventListener("mousedown", function (e) {
        e.preventDefault();
        dragging = true;
        app.classList.add("resizing");
        document.body.style.cursor = "col-resize";
      });
      // Double-click either handle to go back to an even split (clears the inline sizes so the
      // stylesheet's 50/50 applies again).
      handle.addEventListener("dblclick", function () {
        editorPane.style.flex = editorToolbar.style.flex = "";
        previewPane.style.flex = chartToolbar.style.flex = "";
      });
    });
    window.addEventListener("mouseup", function () {
      if (!dragging) return;
      dragging = false;
      app.classList.remove("resizing");
      document.body.style.cursor = "";
    });
    window.addEventListener("mousemove", function (e) {
      if (!dragging) return;
      var rect = split.getBoundingClientRect();
      var pct = (e.clientX - rect.left) / rect.width;
      setSplit(Math.min(0.8, Math.max(0.2, pct)));
    });
  })();

  // ---------- Synchronized scrolling ----------
  // Line-mapped: each chart block carries data-line (its source line). The editor's line tops are
  // measured with a hidden mirror (the textarea wraps long lines), giving pairs of matching
  // scroll positions; scrolling either pane interpolates between the pairs to scroll the other,
  // so the same song line sits at the top of both. Toggle: the round button on the divider.
  var syncScroll = (function () {
    var previewScroll = document.getElementById("previewScroll");
    var btn = document.getElementById("syncScrollBtn");
    var KEY = "chordpro-editor-sync-scroll";
    var enabled = true;
    try { enabled = localStorage.getItem(KEY) !== "off"; } catch (e) {}
    var anchors = null; // [[editorY, previewY], ...] increasing in both
    var driver = null, driverTimer = null;
    var mirror = document.createElement("div");
    mirror.setAttribute("aria-hidden", "true");
    mirror.style.cssText = "position:absolute;visibility:hidden;left:-9999px;top:0;white-space:pre-wrap;overflow-wrap:break-word;word-wrap:break-word;";
    document.body.appendChild(mirror);

    function editorLineTops() {
      var cs = getComputedStyle(editor);
      ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "tabSize", "paddingLeft", "paddingRight", "paddingTop"]
        .forEach(function (p) { mirror.style[p] = cs[p]; });
      mirror.style.boxSizing = "border-box";
      mirror.style.width = editor.clientWidth + "px";
      var lines = editor.value.split("\n");
      mirror.innerHTML = "";
      var frag = document.createDocumentFragment();
      lines.forEach(function (l) {
        var d = document.createElement("div");
        d.textContent = l || "\u200b";
        frag.appendChild(d);
      });
      mirror.appendChild(frag);
      var tops = [];
      for (var i = 0; i < mirror.children.length; i++) tops.push(mirror.children[i].offsetTop);
      return tops;
    }

    function build() {
      var tops = editorLineTops();
      var pad = parseFloat(getComputedStyle(editor).paddingTop) || 0;
      var base = previewScroll.getBoundingClientRect().top - previewScroll.scrollTop;
      var pts = [[0, 0]];
      var els = preview.querySelectorAll("[data-line]");
      for (var i = 0; i < els.length; i++) {
        var line = +els[i].getAttribute("data-line");
        if (tops[line] == null) continue;
        pts.push([tops[line] - pad, els[i].getBoundingClientRect().top - base - 24]);
      }
      pts.sort(function (a, b) { return a[0] - b[0]; });
      var eMax = Math.max(0, editor.scrollHeight - editor.clientHeight);
      var pMax = Math.max(0, previewScroll.scrollHeight - previewScroll.clientHeight);
      // keep only points that move forward in both panes and stay inside the scroll range,
      // then end both panes together
      var out = [[0, 0]];
      pts.forEach(function (p) {
        var last = out[out.length - 1];
        if (p[0] > last[0] && p[1] > last[1] && p[0] < eMax && p[1] < pMax) out.push(p);
      });
      out.push([eMax, pMax]);
      anchors = out;
    }

    function map(y, from, to) {
      if (!anchors) build();
      var a = anchors;
      if (y <= a[0][from]) return a[0][to];
      for (var i = 1; i < a.length; i++) {
        if (y <= a[i][from]) {
          var span = a[i][from] - a[i - 1][from];
          var t = span > 0 ? (y - a[i - 1][from]) / span : 0;
          return a[i - 1][to] + t * (a[i][to] - a[i - 1][to]);
        }
      }
      return a[a.length - 1][to];
    }

    // Only the pane the user is scrolling drives; the other's scroll events are echoes.
    function onScroll(source) {
      if (!enabled) return;
      if (driver && driver !== source) return;
      driver = source;
      clearTimeout(driverTimer);
      driverTimer = setTimeout(function () { driver = null; }, 120);
      if (source === "editor") previewScroll.scrollTop = map(editor.scrollTop, 0, 1);
      else editor.scrollTop = map(previewScroll.scrollTop, 1, 0);
    }

    function invalidate() { anchors = null; }

    // After the chart re-renders (typing, transpose, font...), bring it back in line with the editor.
    function afterRender() {
      anchors = null;
      if (!enabled || driver === "preview") return;
      driver = "editor";
      clearTimeout(driverTimer);
      driverTimer = setTimeout(function () { driver = null; }, 120);
      previewScroll.scrollTop = map(editor.scrollTop, 0, 1);
    }

    function setEnabled(on) {
      enabled = on;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.title = on
        ? "Sync scroll: on - the editor and chart scroll together, line for line. Click to turn off."
        : "Sync scroll: off. Click to scroll the editor and chart together.";
      try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) {}
      if (on) afterRender();
    }

    editor.addEventListener("scroll", function () { onScroll("editor"); });
    previewScroll.addEventListener("scroll", function () { onScroll("preview"); });
    window.addEventListener("resize", invalidate);
    if (window.ResizeObserver) {
      new ResizeObserver(invalidate).observe(editor);
      new ResizeObserver(invalidate).observe(preview);
    }
    // the button lives on the divider: a click toggles, it never starts a divider drag
    btn.addEventListener("mousedown", function (e) { e.stopPropagation(); });
    btn.addEventListener("dblclick", function (e) { e.stopPropagation(); });
    btn.addEventListener("click", function () { setEnabled(!enabled); });
    setEnabled(enabled);
    return { afterRender: afterRender, invalidate: invalidate };
  })();

  // ---------- Boot ----------
  AppSettings.init();
  populateDirectiveUI();
  loadInitial();
  renderNow();
})();
