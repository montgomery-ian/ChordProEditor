/* Extracts a PDF's text in the same shape the .docx importer produces - one paragraph per visual
 * line, "\n\n" between them - so ChordAboveLyrics.convert() handles both imports the same way.
 *
 * The difference is how chords get their columns. A PDF has real x positions, so instead of
 * guessing columns from an average character width (wrong for proportional fonts, and it
 * indented every line by the page margin), each chord line is re-laid-out against the lyric
 * line below it: a chord gets the column of the lyric character printed under it.
 */

var PdfChords = (function () {
  "use strict";

  // PDF text items don't share one exact baseline y even on the same printed line (rounding,
  // mixed font sizes), so items within this many points of each other are treated as one line.
  var LINE_Y_TOLERANCE = 2.5;

  var measureCtx = null;
  function measure(text, size) {
    if (!measureCtx && typeof document !== "undefined") measureCtx = document.createElement("canvas").getContext("2d");
    if (!measureCtx) return text.length; // no canvas: fall back to equal-width characters
    measureCtx.font = Math.max(1, size) + "px Helvetica, Arial, sans-serif";
    return measureCtx.measureText(text).width;
  }

  function groupLines(items) {
    var lines = [];
    // Full-size items first, so a raised superscript ("1st") joins its line instead of starting one.
    items.slice().sort(function (a, b) { return b.size - a.size; }).forEach(function (it) {
      var line = null;
      for (var i = 0; i < lines.length; i++) {
        var tol = it.size < lines[i].size * 0.8 ? Math.max(LINE_Y_TOLERANCE, lines[i].size * 0.5) : LINE_Y_TOLERANCE;
        if (Math.abs(lines[i].y - it.y) <= tol) { line = lines[i]; break; }
      }
      if (!line) { line = { y: it.y, size: it.size, items: [] }; lines.push(line); }
      line.items.push(it);
    });
    lines.sort(function (a, b) { return b.y - a.y; }); // PDF y increases upward: top of page first
    lines.forEach(function (l) { l.items.sort(function (a, b) { return a.x - b.x; }); });
    return lines;
  }

  // Joins a line's items into plain text (no page-margin indent) and records the x position of
  // every character. Within an item, characters are spread over its real printed width in
  // proportion to their measured widths, so x stays accurate for proportional fonts.
  function layoutLine(line) {
    var text = "", xs = [];
    line.items.forEach(function (it) {
      var str = it.str;
      if (text.length) {
        var prevEnd = xs.prevEnd;
        var spaceW = measure(" ", it.size) || it.size * 0.25;
        // Word often splits a chord line into tightly packed items ("Em" "A"): any visible gap
        // separates words, so chords never fuse into one token like "EmA".
        if (!/\s$/.test(text) && !/^\s/.test(str) && it.x - prevEnd > Math.min(spaceW * 0.5, 1)) { text += " "; xs.push(prevEnd); }
      }
      var total = measure(str, it.size) || 1;
      var width = it.width || total;
      for (var i = 0; i < str.length; i++) {
        xs.push(it.x + width * (measure(str.slice(0, i), it.size) / total));
        text += str.charAt(i);
      }
      xs.prevEnd = it.x + width;
    });
    return { text: text, xs: xs, y: line.y };
  }

  // Rebuilds a chord-only line so each chord token sits at the column of the lyric character
  // printed beneath it (or past the end of the lyric, by average width, if it overhangs).
  function alignChordLine(chordLine, lyricLine) {
    var re = /\([^)]*\)?|\S+/g, m, out = ""; // a "(...)" note stays one piece
    var lx = lyricLine.xs, lastX = lx.length ? lx[lx.length - 1] : 0;
    var avg = lx.length > 1 ? (lastX - lx[0]) / (lx.length - 1) : 6;
    var text = lyricLine.text;
    while ((m = re.exec(chordLine.text))) {
      var x = chordLine.xs[m.index] + 1; // 1pt of rounding slack
      // The lyric character whose printed span holds the chord's left edge.
      var col = 0;
      while (col + 1 < lx.length && lx[col + 1] <= x) col++;
      if (lx.length && x > lastX + avg) {
        col = lx.length + Math.max(0, Math.round((x - lastX) / avg) - 1); // overhangs the lyric
      } else if (/\s/.test(text.charAt(col))) {
        // Over a gap between words: belongs to whichever word it is closer to.
        var gs = col, ge = col;
        while (gs > 0 && /\s/.test(text.charAt(gs - 1))) gs--;
        while (ge < text.length && /\s/.test(text.charAt(ge))) ge++;
        var gapStartX = lx[gs], gapEndX = ge < lx.length ? lx[ge] : lastX + avg;
        col = (gs > 0 && x - gapStartX < gapEndX - x) ? gs - 1 : ge;
      }
      if (out.length && col <= out.length) col = out.length + 1; // keep at least one space after the previous chord
      out += new Array(col - out.length + 1).join(" ") + m[0];
    }
    return out;
  }

  function buildPageText(rawLines) {
    var lines = rawLines.map(layoutLine);
    var deltas = [];
    for (var i = 1; i < lines.length; i++) {
      var d = lines[i - 1].y - lines[i].y;
      if (d > 0) deltas.push(d);
    }
    deltas.sort(function (a, b) { return a - b; });
    var typicalGap = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 14;

    var out = [];
    lines.forEach(function (line, i) {
      var gapAbove = i > 0 ? lines[i - 1].y - line.y : 0;
      if (i > 0 && gapAbove > typicalGap * 1.6) out.push("");
      var text = line.text;
      var next = lines[i + 1];
      var nextClose = next && (line.y - next.y) <= typicalGap * 1.6;
      var kind = typeof ChordAboveLyrics !== "undefined" ? ChordAboveLyrics.chordLineKind(text) : null;
      if (kind && !kind.labelled && nextClose && next.text.trim() && !ChordAboveLyrics.isChordLine(next.text)) {
        text = alignChordLine(line, next);
      }
      out.push(text.replace(/\s+$/, ""));
    });
    return out;
  }

  // A footer like "Song / Revision: 06/02/2018" printed at the bottom of every page would land in
  // the middle of the song. Lines that end every page (2+ pages) identically are dropped.
  var FOOTER_LINES = 6; // a footer block can run several lines (credits, copyright)
  function dropRepeatedFooters(pages) {
    if (pages.length < 2) return;
    function tail(lines) {
      var t = lines.filter(function (l) { return l.trim(); });
      return t.slice(-FOOTER_LINES).map(function (l) { return l.trim(); });
    }
    var common = tail(pages[0]).filter(function (l) {
      return pages.every(function (p) { return tail(p).indexOf(l) !== -1; });
    });
    dropRepeatedHeaders(pages);
    if (!common.length) return;
    pages.forEach(function (lines, pi) {
      var keep = lines.filter(function (l, idx) {
        var nonBlankAfter = lines.slice(idx + 1).filter(function (x) { return x.trim(); }).length;
        return !(nonBlankAfter < FOOTER_LINES && common.indexOf(l.trim()) !== -1);
      });
      while (keep.length && !keep[keep.length - 1].trim()) keep.pop();
      pages[pi] = keep;
    });
  }

  // A running header ("Song - Intro, V1, C1 ...") at the top of every page after the first is
  // dropped the same way: lines that open each later page identically (or repeat page 1's first
  // line). Bare page numbers anywhere are dropped too.
  var HEADER_LINES = 3;
  function dropRepeatedHeaders(pages) {
    function head(lines) {
      return lines.filter(function (l) { return l.trim(); }).slice(0, HEADER_LINES).map(function (l) { return l.trim(); });
    }
    var later = pages.slice(1);
    var firstLine = head(pages[0])[0];
    var common = head(later[0]).filter(function (l) {
      if (typeof ChordAboveLyrics !== "undefined" && ChordAboveLyrics.isChordLine(l)) return false;
      if (later.length >= 2) return later.every(function (p) { return head(p).indexOf(l) !== -1; });
      return l === firstLine;
    });
    pages.forEach(function (lines, pi) {
      var seen = 0;
      pages[pi] = lines.filter(function (l) {
        if (/^\s*(?:page\s*)?\d{1,3}\s*$/i.test(l)) return false; // page number
        if (!l.trim()) return true;
        seen++;
        return !(pi > 0 && seen <= HEADER_LINES && common.indexOf(l.trim()) !== -1);
      });
      while (pages[pi].length && !pages[pi][0].trim()) pages[pi].shift();
    });
  }

  // Some chart exporters fill the gaps between words with dots drawn in white ("..For.my.waking"),
  // so the text reads fine on paper but comes out dotted. When dots are far more common than in
  // normal writing, they're filler: turn them back into spaces (same width, so columns hold).
  function undotFiller(pages) {
    var dots = 0, letters = 0;
    pages.forEach(function (items) {
      items.forEach(function (it) {
        dots += (it.str.match(/\./g) || []).length;
        letters += (it.str.match(/[A-Za-z]/g) || []).length;
      });
    });
    if (!letters || dots / letters < 0.12) return;
    // only in dot-filled text; a normal line with real spaces (a copyright footer) keeps its periods
    pages.forEach(function (items) {
      items.forEach(function (it) {
        var spaces = (it.str.match(/ /g) || []).length;
        var d = (it.str.match(/\./g) || []).length;
        if (d && d >= spaces * 2) it.str = it.str.replace(/\./g, " ");
      });
    });
  }

  function extractColumnText(arrayBuffer) {
    if (typeof pdfjsLib === "undefined") return Promise.reject(new Error("pdf.js did not load (no internet connection?)"));
    return pdfjsLib.getDocument({ data: arrayBuffer }).promise.then(function (pdf) {
      var pagePromises = [];
      for (var p = 1; p <= pdf.numPages; p++) pagePromises.push(pdf.getPage(p));
      return Promise.all(pagePromises);
    }).then(function (pages) {
      return Promise.all(pages.map(function (page) { return page.getTextContent(); }));
    }).then(function (contents) {
      var pageItems = contents.map(function (content) {
        return content.items
          .filter(function (it) { return it.str && it.str.trim().length; })
          .map(function (it) {
            var size = Math.abs(it.transform[3]) || Math.abs(it.transform[0]) || it.height || 12;
            return { str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, size: size };
          });
      });
      undotFiller(pageItems);
      var pages = pageItems.map(function (items) {
        return buildPageText(groupLines(items.filter(function (it) { return it.str.trim().length; })));
      });
      dropRepeatedFooters(pages);
      return pages.map(function (lines) { return lines.join("\n\n"); }).join("\n\n\n\n");
    });
  }

  return { extractColumnText: extractColumnText };
})();
