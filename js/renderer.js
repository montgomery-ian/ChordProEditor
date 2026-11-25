/* AST -> HTML chord chart. */

var ChordProRenderer = (function () {
  "use strict";

  var META_FIELDS = [
    { key: "subtitle", label: null },
    { key: "artist", label: "Artist" },
    { key: "composer", label: "Composer" },
    { key: "lyricist", label: "Lyricist" },
    { key: "arranger", label: "Arranger" },
    { key: "album", label: "Album" },
    { key: "year", label: "Year" },
    { key: "key", label: "Key" },
    { key: "time", label: "Time" },
    { key: "tempo", label: "Tempo" },
    { key: "duration", label: "Duration" },
    { key: "copyright", label: "©" },
    { key: "ccli", label: "CCLI #" }
  ];

  var DEFINE_RE = /^(\S+)\s+base-fret\s+(\d+)\s+frets\s+(.+)$/i;

  function ordinal(n) {
    var suffixes = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function parseDefine(value) {
    var m = DEFINE_RE.exec(value.trim());
    if (!m) return null;
    var name = m[1];
    var baseFret = Math.max(1, parseInt(m[2], 10) || 1);
    var fretTokens = m[3].trim().split(/\s+/);
    var frets = [];
    // Per the ChordPro spec, {define:} frets are relative to base-fret (1 = the top fret shown),
    // with 0 = open and x/X/N/-1 = muted. Stored as absolute frets, like the built-in shapes.
    for (var i = 0; i < fretTokens.length; i++) {
      var t = fretTokens[i];
      if (/^(x|X|N|-1)$/.test(t)) frets.push("x");
      else if (/^\d+$/.test(t)) {
        var rel = parseInt(t, 10);
        frets.push(rel === 0 ? 0 : rel + baseFret - 1);
      }
      else break; // stop at "fingers" or other trailing keywords
    }
    return { name: name, baseFret: baseFret, frets: frets };
  }

  // A capo describes the song globally (however far down the file the directive sits), so unlike
  // {transpose:} - which applies only to what follows it - its shift is folded in up front.
  function findCapoValue(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.type === "directive" && n.name === "capo") {
        var v = parseInt(n.value, 10);
        if (!isNaN(v)) return v;
      } else if (n.type === "environment") {
        var inner = findCapoValue(n.children);
        if (inner !== null) return inner;
      }
    }
    return null;
  }

  function render(ast, opts) {
    opts = opts || {};
    var capoSemitones = findCapoValue(ast.children) || 0;
    // transposeSteps drives the actual chord math (capo folded in); manualTransposeSteps is just
    // for the "Transposed" note, which should only call out an intentional transpose, not a capo.
    // The chords written in the source are what the song sounds like; a capo raises the pitch of
    // whatever shape you fret, so to sound the same written chord you must fret a LOWER shape -
    // e.g. capo 2 + a written G means playing an F shape (F + 2 semitones = G).
    var transposeSteps = (opts.transpose || 0) - capoSemitones;
    var manualTransposeSteps = opts.transpose || 0;
    var useFlats = !!opts.useFlats;

    // Chord notation: "traditional" (letters), "nashville" (1 2 3...) or "roman" (I ii iii...).
    // Numbers count from the {key:}, as written in the source; with no key, from the first chord.
    var notation = opts.notation === "nashville" || opts.notation === "roman" ? opts.notation : "traditional";
    var keyIdx = null, keyName = null, keyGuessed = false, keyMinor = false;
    if (notation !== "traditional") {
      (function findKey(nodes) {
        for (var i = 0; i < nodes.length && keyName === null; i++) {
          var n = nodes[i];
          if (n.type === "directive" && n.name === "key" && n.value.trim()) keyName = n.value.trim();
          else if (n.type === "environment") findKey(n.children);
        }
      })(ast.children);
      if (keyName === null) {
        var allChords = [];
        (function collect(nodes) {
          nodes.forEach(function (n) {
            if (n.type === "line" && !n.raw_only) n.cells.forEach(function (c) { if (c.chord) allChords.push(c.chord); });
            else if (n.type === "environment") collect(n.children);
          });
        })(ast.children);
        var guessed = ChordTheory.guessKey(allChords);
        if (guessed !== null) { keyName = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][guessed]; keyGuessed = true; }
      }
      var keyChord = keyName && ChordTheory.parseChord(keyName);
      if (keyChord) keyIdx = ChordTheory.noteIndex(keyChord.root);
      if (keyChord) {
        keyMinor = /^m(?!aj)|^min/.test(keyChord.suffix);
        keyName = keyChord.root + (keyMinor ? "m" : "");
      }
    }

    var meta = {};
    var chordDefs = {};
    var chordsUsed = []; // ordered unique list, excluding annotations
    var chordsSeen = {};
    var lastChorusHtml = null;

    // One diagram per chord: beat marks (G#/ vs G#) don't make a new chord, and N.C. / NC
    // ("no chord") or other text gets no diagram at all.
    function noteChord(sym) {
      if (!ChordTheory.isChord(sym)) return;
      var key = ChordTheory.splitBeats(sym).chord;
      if (!chordsSeen[key]) { chordsSeen[key] = true; chordsUsed.push(key); }
    }

    // Each chord's following chord (in song order), so Roman numerals can spot secondary
    // dominants (V/V, V/vi...). N.C. breaks the chain.
    if (notation === "roman") (function linkNext() {
      var prev = null;
      (function walk(nodes) {
        nodes.forEach(function (n) {
          if (n.type === "line" && !n.raw_only) {
            n.cells.forEach(function (c) {
              if (!c.chord) return;
              if (!ChordTheory.isChord(c.chord)) { prev = null; return; }
              if (prev) prev.nextChord = c.chord;
              prev = c;
            });
          } else if (n.type === "environment") walk(n.children);
        });
      })(ast.children);
    })();

    function renderChordLabel(sym, nextSym) {
      if (!sym) return "";
      noteChord(sym);
      if (notation !== "traditional" && keyIdx != null) {
        var degreeHtml = ChordTheory.formatDegree(sym, keyIdx, notation, keyMinor, opts.minorMark, nextSym);
        if (degreeHtml) return degreeHtml;
      }
      var shown = ChordTheory.transposeChord(sym, transposeSteps, useFlats);
      return esc(shown);
    }

    function renderLineNode(node) {
      if (node.raw_only) {
        return '<div class="raw-line">' + esc(node.raw) + "</div>";
      }
      var hasChord = node.cells.some(function (c) { return c.chord || c.annotation; });
      if (!hasChord) {
        // Pure lyric line, no chord row needed above it.
        var text = node.cells.map(function (c) { return c.text; }).join("");
        if (text.trim() === "") return '<div class="lyric-line empty-line">&nbsp;</div>';
        return '<div class="lyric-line no-chords"><span class="lyric-text">' + esc(text) + "</span></div>";
      }
      var html = '<div class="chord-line">';
      node.cells.forEach(function (cell) {
        var chordHtml = "";
        if (cell.annotation) {
          chordHtml = '<span class="annotation">' + esc(cell.annotation) + "</span>";
        } else if (cell.chord) {
          chordHtml = '<span class="chord-name">' + renderChordLabel(cell.chord, cell.nextChord) + "</span>";
        }
        var textHtml = cell.text ? esc(cell.text) : "";
        html += '<span class="chord-cell"><span class="chord-slot">' + chordHtml + '</span><span class="lyric-slot">' + (textHtml || "&nbsp;") + "</span></span>";
      });
      html += "</div>";
      return html;
    }

    function renderDirectiveNode(node) {
      switch (node.name) {
        case "comment":
          return '<div class="comment">' + esc(node.value) + "</div>";
        case "comment_italic":
          return '<div class="comment comment-italic">' + esc(node.value) + "</div>";
        case "comment_box":
          return '<div class="comment comment-box">' + esc(node.value) + "</div>";
        case "highlight":
          return '<div class="comment highlight">' + esc(node.value) + "</div>";
        case "image": {
          var src = node.attrs && node.attrs.src;
          if (!src) return "";
          var style = "";
          if (node.attrs.scale) style = ' style="max-width:' + esc(node.attrs.scale) + '"';
          return '<div class="song-image"><img src="' + esc(src) + '" alt=""' + style + "/></div>";
        }
        case "define": {
          var def = parseDefine(node.value);
          if (def) {
            var selectorInstrument = node.selector ? ChordInstruments.detectFromText(node.selector) : null;
            (chordDefs[def.name] = chordDefs[def.name] || []).push({
              instrument: selectorInstrument, // null = no selector, applies by string-count match
              frets: def.frets,
              baseFret: def.baseFret
            });
          }
          return "";
        }
        case "transpose": {
          var n = parseInt(node.value, 10);
          if (!isNaN(n)) { transposeSteps += n; manualTransposeSteps += n; }
          return "";
        }
        case "new_page":
        case "new_physical_page":
          return '<div class="divider page-break" title="Page break (print layout)"></div>';
        case "column_break":
          return '<div class="divider column-break" title="Column break (print layout)"></div>';
        case "new_song":
          return '<hr class="song-separator"/>';
        case "chorus": {
          var repeatLabel = esc(node.value || "Chorus"); // {chorus: Chorus (Band in)} keeps its label
          if (lastChorusHtml) return '<div class="env env-chorus env-repeat"><div class="env-label">' + repeatLabel + "</div>" + lastChorusHtml + "</div>";
          return '<div class="env env-chorus env-repeat empty"><div class="env-label">Chorus (repeat)</div></div>';
        }
        default:
          return ""; // meta already harvested, legacy/print-only directives are no-ops in the live chart
      }
    }

    function harvestMeta(node) {
      var field = null;
      for (var i = 0; i < META_FIELDS.length; i++) if (META_FIELDS[i].key === node.name) { field = META_FIELDS[i]; break; }
      if (node.name === "title" || node.name === "subtitle" || field) {
        if (!meta[node.name]) meta[node.name] = node.value;
        else meta[node.name] += ", " + node.value;
        return true;
      }
      return false;
    }

    var ENV_LABELS = { chorus: "Chorus", verse: "Verse", bridge: "Bridge", tab: "Tab", grid: "Grid" };

    // Tags a rendered block with the source line it came from (data-line), so the app can line up
    // the editor and the chart when scrolling.
    function tagLine(html, node) {
      if (node.srcLine == null) return html;
      return html.replace(/^<(div|hr|pre)\b/, '$& data-line="' + node.srcLine + '"');
    }

    function renderNodes(nodes) {
      var out = "";
      nodes.forEach(function (node) {
        if (node.type === "directive") {
          if (harvestMeta(node)) return;
          out += tagLine(renderDirectiveNode(node), node);
        } else if (node.type === "line") {
          out += tagLine(renderLineNode(node), node);
        } else if (node.type === "environment") {
          var cls = "env env-" + (ENV_LABELS[node.name] ? node.name : "generic");
          var label = node.label || ENV_LABELS[node.name] || node.name.replace(/_/g, " ");
          var isRaw = node.name === "tab" || node.name === "grid" || node.name === "abc" || node.name === "ly" || node.name === "svg" || node.name === "textblock";
          var body;
          if (isRaw) {
            var rawLines = node.children
              .filter(function (c) { return c.type === "line" || c.type === "empty"; })
              .map(function (c) { return c.type === "line" ? c.raw : ""; });
            body = '<pre class="raw-block">' + esc(rawLines.join("\n")) + "</pre>";
          } else {
            var inner = renderNodes(node.children);
            body = '<div class="env-body">' + inner + "</div>";
            // a repeated chorus maps to its {chorus} line, not to the original chorus's lines
            if (node.name === "chorus") lastChorusHtml = body.replace(/ data-line="\d+"/g, "");
          }
          out += '<div class="' + cls + '"' + (node.srcLine != null ? ' data-line="' + node.srcLine + '"' : "") + '><div class="env-label">' + esc(label) + "</div>" + body + "</div>";
        }
        // comment-line and empty nodes at top level are ignored visually (spacing handled by CSS between blocks)
      });
      return out;
    }

    var bodyHtml = renderNodes(ast.children);

    // Header
    var header = "";
    if (meta.title) header += '<h1 class="meta-title">' + esc(meta.title) + "</h1>";
    if (meta.subtitle) header += '<div class="meta-sub">' + esc(meta.subtitle) + "</div>";
    var lineParts = [];
    META_FIELDS.forEach(function (f) {
      if (f.key === "subtitle") return;
      if (meta[f.key]) lineParts.push((f.label ? '<span class="meta-field-label">' + esc(f.label) + ":</span> " : "") + esc(meta[f.key]));
    });
    if (lineParts.length) header += '<div class="meta-line">' + lineParts.join('<span class="meta-sep">·</span>') + "</div>";
    if (notation !== "traditional") {
      var notationName = notation === "roman" ? "Roman numerals" : "Nashville numbers";
      header += '<div class="meta-line notation-note">' + notationName +
        (keyIdx != null ? " in " + esc(keyName) + (keyGuessed ? " (guessed - add {key:} to set it)" : "") : " - add a {key:} to number the chords") +
        "</div>";
    }
    if (manualTransposeSteps && notation === "traditional") header += '<div class="meta-line transpose-note">Transposed ' + (manualTransposeSteps > 0 ? "+" : "") + manualTransposeSteps + " semitone" + (Math.abs(manualTransposeSteps) === 1 ? "" : "s") + "</div>";
    if (capoSemitones) {
      header += '<div class="capo-banner"><span class="capo-banner-badge">Capo</span><span class="capo-banner-fret">' +
        ordinal(capoSemitones) + ' fret</span></div>';
    }

    // Chord diagram strip - instrument-aware: a custom {define:} is only used when it was
    // written for this instrument (matching selector, or no selector but matching string count).
    var diagramHtml = "";
    if (opts.showDiagrams !== false && chordsUsed.length) {
      var instrument = ChordInstruments.DEFS[opts.instrument] ? opts.instrument : "guitar";
      var stringCount = ChordTheory.INSTRUMENT_STRING_COUNT[instrument];

      function findCustomDiagram(name) {
        var entries = chordDefs[name];
        if (!entries) return null;
        for (var i = 0; i < entries.length; i++) if (entries[i].instrument === instrument) return entries[i];
        for (var j = 0; j < entries.length; j++) if (!entries[j].instrument && entries[j].frets.length === stringCount) return entries[j];
        return null;
      }

      var chips = chordsUsed.map(function (sym) {
        var shownSym = ChordTheory.transposeChord(sym, transposeSteps, useFlats);
        var def = findCustomDiagram(shownSym) || ChordTheory.diagramFor(shownSym, instrument);
        if (def) return '<div class="chord-chip">' + ChordTheory.renderDiagramSVG(shownSym, def) + "</div>";
        return '<div class="chord-chip chord-chip-text">' + esc(shownSym) + "</div>";
      }).join("");
      var badge = '<div class="instrument-badge">' + ChordInstruments.DEFS[instrument].label + " chord diagrams</div>";
      diagramHtml = '<div class="chord-strip-wrap">' + badge + '<div class="chord-strip">' + chips + "</div></div>";
    }

    return '<div class="song-header">' + header + "</div>" + diagramHtml + '<div class="song-body">' + bodyHtml + "</div>";
  }

  return { render: render };
})();
