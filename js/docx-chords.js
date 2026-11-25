/* Converts "chords on their own line, positioned above the lyric they ring on" text
 * (the layout produced by Word chord charts that use tabs/spaces for alignment, and by
 * mammoth's plain-text extraction of such a .docx) into real inline ChordPro [Chord] syntax.
 *
 * Only lines that are UNAMBIGUOUSLY chord lines (every token is a recognized chord symbol or a
 * parenthesized note like "(2x)" or "(…ring)", optionally after a section label like "Intro:")
 * are touched. Parenthesized notes are kept as ChordPro annotations, e.g. [*(…ring)]. Anything else - including a chord line with stray extra words mixed in -
 * is left exactly as written, so a bad guess never corrupts real lyrics.
 */

var ChordAboveLyrics = (function () {
  "use strict";

  // Mirrors ChordTheory.parseChord's root matching, but whitelists the suffix instead of
  // accepting any trailing text - otherwise ordinary capitalized words starting with A-G
  // (e.g. "Bend", "Day") would be mistaken for chords.
  var SUFFIXES = [
    "maj13", "maj11", "maj9", "maj7", "maj",
    "m7b5", "m7#5", "mmaj7", "madd9",
    "add9", "add11",
    "dim7", "dim", "aug",
    "sus2", "sus4", "sus", "no3", "add2", "add4",
    "min13", "min11", "min9", "min7", "min",
    "m13", "m11", "m9", "m7", "m6", "m",
    "6/9", "69", "6", "7sus4", "7sus", "7b5", "7#5", "7", "9", "11", "13", "5", "4", "2"
  ];
  var CHORD_TOKEN_RE = new RegExp(
    "^[A-G](?:#|b)?(?:" + SUFFIXES.join("|") + ")?" +
    "(?:\\((?:no\\d|omit\\d|add\\d+|sus\\d?|[#b]\\d+|\\d+|maj\\d*)\\))?" + // Eb(4), Db2(no3), C(add9)
    "(?:/[A-G](?:#|b)?)?$"
  );
  // Bar lines and repeat signs in a chord row: | || |: :| ||: :|| (kept as text, not chords)
  var BAR_TOKEN_RE = /^(?:\|\|?:?|:?\|\|?|%)$/;
  var PAREN_COUNT_RE = /^\d+x$/i; // a bare "2x" repeat count
  var LABEL_WORD_RE = /^(intro|outro|verse|chorus|bridge|tag|interlude|pre-?chorus|prechorus|refrain|instrumental|vamp|hook|turnaround|ending|coda|break|solo|riff|lead)s?$/i;

  // A "(...)" group counts as one token, even with spaces inside, e.g. "(1x … Jeff alone)".
  function tokenize(line) {
    var tokens = [];
    var re = /\([^)]*\)?|[^\s(]+\([^)\s]*\)|\S+/g;
    var m;
    while ((m = re.exec(line))) tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    return tokens;
  }

  function isChordToken(t) { return CHORD_TOKEN_RE.test(t.text); }
  function isBarToken(t) { return BAR_TOKEN_RE.test(t.text); }
  function isParenToken(t) { return t.text.charAt(0) === "(" || PAREN_COUNT_RE.test(t.text); }

  // How many leading tokens make up a section label like "Verse:", "Verse: 1", "Chorus" ?
  function labelPrefixCount(tokens) {
    if (!tokens.length) return 0;
    var first = tokens[0].text.replace(/:$/, "");
    if (!LABEL_WORD_RE.test(first)) return 0;
    var i = 1;
    if (i < tokens.length && tokens[i].text === ":") i++;
    if (i < tokens.length && /^\d+:?$/.test(tokens[i].text)) i++;
    return i;
  }

  // Classifies a (trimmed-at-end) line. Returns null if it is not a pure chord line, otherwise
  // { chordTokens, prefixEnd } where chordTokens are the real chords (with original start/end
  // offsets into `line`) and prefixEnd is the character offset where a leading label ends.
  function classify(line) {
    var tokens = tokenize(line);
    var prefixCount = labelPrefixCount(tokens);
    var rest = tokens.slice(prefixCount);
    if (!rest.length) return null;
    var chordTokens = [], hasChord = false, hasBars = false;
    for (var i = 0; i < rest.length; i++) {
      var t = rest[i];
      if (isChordToken(t)) { chordTokens.push(t); hasChord = true; }
      else if (isBarToken(t)) hasBars = true; // stays in the line as text
      else if (isParenToken(t)) chordTokens.push({ text: "*" + t.text.replace(/\]/g, ")"), start: t.start, end: t.end });
      else if (chordTokens.filter(function (c) { return c.text.charAt(0) !== "*"; }).length >= 3) {
        // A spoken cue after a run of chords ("G D Bm A (hold) Drum roll into break 2"):
        // keep the rest of the line as one annotation. Needs 3+ chords first, so a lyric line
        // that merely starts with a chord-like word ("A day ...") is never mistaken for this.
        var last = rest[rest.length - 1];
        chordTokens.push({ text: "*" + line.slice(t.start, last.end).replace(/\s+/g, " ").replace(/\]/g, ")"), start: t.start, end: last.end });
        break;
      }
      else return null; // a real word mixed in - too risky, leave it alone
    }
    if (!hasChord) return null;
    var prefixEnd = prefixCount > 0 ? tokens[prefixCount - 1].end : 0;
    return { chordTokens: chordTokens, prefixEnd: prefixEnd, bars: hasBars };
  }

  // Splices "[Chord]" markers into `text` at each token's original column, right-to-left so
  // earlier insertions don't shift the columns still to be inserted.
  function spliceChords(text, chordTokens) {
    var baseLength = text.length; // clamp (and snap) against the ORIGINAL text throughout, not
    // the growing string - otherwise a later insertion's snap-back can walk past an earlier
    // one's brackets and land in the wrong order when several chords share one target word.
    var sorted = chordTokens
      .map(function (t) { return { text: t.text, start: t.start, idx: snapToWordStart(text, Math.min(t.start, baseLength)) }; })
      .sort(function (a, b) { return b.start - a.start; }) // descending start first, so a stable
      .sort(function (a, b) { return b.idx - a.idx; });     // sort by idx preserves that order on ties
    for (var i = 0; i < sorted.length; i++) {
      var t = sorted[i];
      text = text.slice(0, t.idx) + "[" + t.text + "]" + text.slice(t.idx);
    }
    return text;
  }

  // A column measured from a tab-expanded chord line often lands a character or two into a
  // word rather than exactly on its first letter. When that happens, prefer the unambiguous,
  // readable choice and back up to the start of that word - never leave a chord mid-word.
  function snapToWordStart(text, idx) {
    if (idx <= 0 || idx >= text.length) return idx;
    var before = text[idx - 1];
    if (/\s/.test(before) || before === "]") return idx; // already at a clean boundary
    if (/\s/.test(text[idx])) { // chord falls in a gap: it rings on the next word, not the last
      while (idx < text.length && /\s/.test(text[idx])) idx++;
      return idx;
    }
    while (idx > 0 && !/\s/.test(text[idx - 1]) && text[idx - 1] !== "]") idx--;
    return idx;
  }

  // Removes the chord-name characters from a chord-only line (replacing them with matching
  // spaces) so that spliceChords can re-insert them as brackets without duplicating the text.
  function blankOutTokens(line, chordTokens) {
    var sorted = chordTokens.slice().sort(function (a, b) { return a.start - b.start; });
    var out = "";
    var cursor = 0;
    sorted.forEach(function (t) {
      out += line.slice(cursor, t.start) + new Array(t.end - t.start + 1).join(" ");
      cursor = t.end;
    });
    out += line.slice(cursor);
    return out;
  }

  function convert(rawText) {
    var paragraphs = rawText.replace(/\r\n/g, "\n").split("\n\n");
    var out = [];
    var mergedCount = 0;
    var standaloneCount = 0;
    var i = 0;

    while (i < paragraphs.length) {
      var line = paragraphs[i].replace(/\s+$/, "");
      if (line.trim() === "") {
        if (out.length && out[out.length - 1] !== "") out.push("");
        i++;
        continue;
      }

      var info = classify(line);
      if (!info) {
        out.push(line);
        i++;
        continue;
      }

      var next = i + 1 < paragraphs.length ? paragraphs[i + 1].replace(/\s+$/, "") : null;
      var nextIsBlank = next === null || next.trim() === "";
      var nextInfo = nextIsBlank ? null : classify(next);

      // A labelled line ("Intro: D G", "Break 1: ...") is an instrumental part played on its own,
      // never chords for the line below it, so it stays a line of its own and keeps its label.
      // A row with bar lines (| Ab | Eb |) is a run of measures, also played on its own.
      if (!nextIsBlank && !nextInfo && info.prefixEnd === 0 && !info.bars) {
        out.push(spliceChords(next, info.chordTokens));
        mergedCount++;
        i += 2;
      } else {
        var blanked = blankOutTokens(line, info.chordTokens);
        out.push(spliceChords(blanked, info.chordTokens).replace(/\s+$/, ""));
        standaloneCount++;
        i += 1;
      }
    }

    // Indentation in the source (centred or indented lyrics) means nothing in ChordPro.
    out = out.map(function (l) { return l.replace(/^\s+/, ""); });
    out = addSongStructure(out);
    return { text: out.join("\n"), mergedCount: mergedCount, standaloneCount: standaloneCount };
  }

  // ---------- Song structure: title/artist and verse/chorus/bridge sections ----------

  // "Verse 1:", "Verse: 1", "Verse 1", "Chorus:" ...
  // Any case, with an optional number (digits or a word), colon, repeat count and notes:
  // "VERSE 1 (ACOUSTIC ONLY)", "Chorus (Band in):", "Verse Two -", "Chorus x2".
  var SECTION_HEADING_RE = /^\s*(verse|chorus|bridge|pre-?chorus|intro|outro|tag|turnaround|instrumental|interlude|ending|coda|refrain|vamp)\b\s*[:.\-–]?\s*(\d+|one|two|three|four|five|six|seven|eight)?\s*[:.\-–]?\s*((?:\([^)]*\)|\d+\s*x|x\s*\d+)(?:\s*(?:\([^)]*\)|\d+\s*x|x\s*\d+))*)?\s*[:.\-–]?\s*$/i;
  var NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

  // "VERSE 1 (ACOUSTIC ONLY)" -> "Verse 1 (Acoustic only)"
  function sectionLabel(m) {
    var label = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    if (m[2]) label += " " + (NUMBER_WORDS[m[2].toLowerCase()] || m[2]);
    if (m[3]) {
      var note = m[3].replace(/\s+/g, " ").trim();
      if (note === note.toUpperCase()) note = note.toLowerCase().replace(/([(]\s*)([a-z])/g, function (x, p, c) { return p + c.toUpperCase(); });
      label += " " + note;
    }
    return label;
  }
  var LABELLED_LINE_RE = new RegExp("^\\s*" + LABEL_WORD_RE.source.replace(/^\^|\$$/g, "") + "\\s*\\d*\\s*:", "i");
  var DATE_TAIL_RE = /\s+((?:written|revised|revision|date|dated)\s*:?.*|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})$/i;
  var AUTHOR_SPLIT_RE = /^(.+?)\s+(?:[\u2013\u2014-]|by)\s+(.+)$/i;

  function isPlainText(line) {
    return line.trim() && line.indexOf("[") === -1 && !/^\s*[{#]/.test(line) && !classify(line);
  }

  // The first line becomes {title:} (and {artist:} after a dash or "by"), when it reads like a
  // heading: plain text, short, and not followed straight away by more lyrics.
  // Header details many chart exporters print, in whatever layout:
  //   "Abide [Ab, 49 bpm, 6/8]" or "(Key of G)"  -> {key}, {tempo}, {time} (and the title is the rest)
  //   "Key: G", "Tempo - 72", "Time: 6/8"        -> the same, as lines of their own
  //   "Intro, V1, C1, V2, C2, Bridge"            -> {comment: ...} (the song's road map)
  //   "[Default Arrangement] by ..."             -> bracketed notes dropped, "by ..." -> artist
  //   "© 2019 ...", "CCLI Song # 7168160"         -> {copyright}, {ccli} (anywhere in the song)
  // Header lines are the ones before the first section heading or chord line. Found details
  // are removed from the text and returned as directives in `meta`.
  var KEY_RE = /^(?:key(?:\s*of)?\s*[:\-]?\s*)?([A-G][#b♯♭]?(?:m|min|minor|maj|major)?)$/i;
  var ROADMAP_ITEM_RE = /^(?:intro|outro|verse|chorus|bridge|pre-?chorus|tag|turn(?:around)?|inst(?:rumental)?|interlude|ending|coda|vamp|refrain|v|c|b|pc|t|i|o)\s*\d*(?:\s*x\s*\d+)?$/i;

  function metaFromBits(bits, meta) {
    var used = false;
    bits.forEach(function (bit) {
      bit = bit.trim();
      var m;
      if ((m = /^(\d{2,3})\s*bpm$/i.exec(bit)) || (m = /^(?:tempo|bpm)\s*[:\-]?\s*(\d{2,3})$/i.exec(bit))) { meta.push("{tempo: " + m[1] + "}"); used = true; }
      else if ((m = /^(?:time(?:\s*signature)?\s*[:\-]?\s*)?(\d{1,2}\/\d{1,2})$/i.exec(bit))) { meta.push("{time: " + m[1] + "}"); used = true; }
      else if ((m = KEY_RE.exec(bit)) && (/key/i.test(bit) || bits.length > 1)) {
        meta.push("{key: " + m[1].replace("♯", "#").replace("♭", "b").replace(/minor|min/i, "m").replace(/major|maj/i, "") + "}");
        used = true;
      }
    });
    return used;
  }

  function extractHeaderMeta(lines, meta) {
    var out = [];
    var inHeader = true, headerSeen = 0;
    lines.forEach(function (line) {
      var t = line.trim();
      var m;
      // copyright / CCLI lines can sit anywhere (usually the footer)
      if ((m = /^(?:©|\(c\)|copyright\b)\s*:?\s*(.+)$/i.exec(t))) { meta.push("{copyright: " + m[1].trim() + "}"); return; }
      if ((m = /\bCCLI\s*(?:song)?\s*(?:#|no\.?|number)?\s*:?\s*(\d{3,})/i.exec(t)) && !/\[/.test(t)) { meta.push("{ccli: " + m[1] + "}"); return; }
      if (inHeader && t) {
        if (SECTION_HEADING_RE.test(t) || classify(t) || /\[/.test(t.replace(/^\s*\[[^\]]*\]/, "").replace(/\[[^\]]*\]\s*$/, "")) || headerSeen >= 6) inHeader = false;
      }
      if (inHeader && t) {
        headerSeen++;
        // trailing [Ab, 49 bpm, 6/8] or (Key of G)
        var tail = /\s*[\[(]([^\])]*)[\])]\s*$/.exec(t);
        if (tail && metaFromBits(tail[1].split(/[,;|]/), meta)) { t = t.slice(0, tail.index).trim(); line = t; }
        // a leading [Default Arrangement]-style note
        t = t.replace(/^\[[^\]]*\]\s*/, ""); line = t;
        // "Key: G | Tempo: 72 | Time: 4/4"
        if (/^(key|tempo|bpm|time)\b/i.test(t) && metaFromBits(t.split(/\s*[,;|]\s*|\s{2,}/), meta)) return;
        var items = t.split(/\s*,\s*/);
        if (items.length >= 3 && items.every(function (x) { return ROADMAP_ITEM_RE.test(x); })) { meta.push("{comment: " + t + "}"); return; }
        if (!t) return;
      }
      out.push(line);
    });
    return out;
  }

  function extractTitle(lines, extraMeta) {
    extraMeta = extraMeta || [];
    var i = 0;
    while (i < lines.length && !lines[i].trim()) i++;
    if (i >= lines.length) return extraMeta.length ? extraMeta.concat([""], lines) : lines;
    var first = lines[i].trim();
    if (!isPlainText(first) || first.length > 90 || SECTION_HEADING_RE.test(first) || LABELLED_LINE_RE.test(first)) return extraMeta.length ? extraMeta.concat([""], lines) : lines;
    var j = i + 1;
    var next = j < lines.length ? lines[j] : "";
    var dateMatch = DATE_TAIL_RE.exec(first);
    var head = dateMatch ? first.slice(0, dateMatch.index).trim() : first;
    var split = AUTHOR_SPLIT_RE.exec(head);
    var followedByLyric = next.trim() && isPlainText(next) && !SECTION_HEADING_RE.test(next) && !/^\s*\(/.test(next);
    var nextIsBy = /^\s*(?:by|words and music by|written by)\b/i.test(next);
    if (followedByLyric && !split && !dateMatch && !nextIsBy && !extraMeta.length) return lines; // probably the song's first lyric line

    var meta = [];
    meta.push("{title: " + (split ? split[1] : head).trim() + "}");
    if (split) meta.push("{artist: " + split[2].trim() + "}");
    // "by Someone" on the line right after the title
    var byLine = /^\s*(?:by|words and music by|artist|author|written by)\s*:?\s+(.+)$/i.exec(next);
    if (!split && byLine) { meta.push("{artist: " + byLine[1].trim() + "}"); j++; }
    if (dateMatch) {
      // "Written by: Jeffrey M. Lauer 03/12/19" -> {artist: Jeffrey M. Lauer} + {comment: 03/12/19}
      var credit = /^(?:written|words and music|music|words|composed)\s+by\s*:?\s*(.+?)\s*(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})?\s*$/i.exec(dateMatch[1].trim());
      if (credit && !split) {
        meta.push("{artist: " + credit[1] + "}");
        if (credit[2]) meta.push("{comment: Written " + credit[2] + "}");
      } else {
        meta.push("{comment: " + dateMatch[1].trim() + "}");
      }
    }
    return lines.slice(0, i).concat(meta, extraMeta, [""], lines.slice(j));
  }

  // Letters only, chords and notes removed: used to tell whether a later chorus repeats the first.
  function lyricKey(sectionLines) {
    return sectionLines.join(" ").replace(/\[[^\]]*\]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  }
  function similar(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    // share a long common prefix and nearly the same length (catches "(ring)" vs "(…ring)")
    var n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n++;
    return n / Math.max(a.length, b.length) >= 0.85;
  }

  // "Verse 1:" / "Chorus" / "Bridge" headings become ChordPro sections. A section runs until a
  // blank line, the next heading, or a labelled instrumental line ("Break 1: ..."). The first
  // chorus is wrapped in {start_of_chorus}/{end_of_chorus}; a later chorus that repeats it is
  // replaced by {chorus}. A different-worded later chorus is kept in full.
  function addSongStructure(lines) {
    var headerMeta = [];
    lines = extractHeaderMeta(lines, headerMeta);
    lines = extractTitle(lines, headerMeta);
    var out = [];
    var firstChorusKey = null;
    var i = 0;
    while (i < lines.length) {
      var m = SECTION_HEADING_RE.exec(lines[i]);
      if (!m) { out.push(lines[i]); i++; continue; }
      var kind = m[1].toLowerCase().replace(/-/g, ""); // any section name works: {start_of_intro}
      var label = sectionLabel(m);
      var j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++; // blank lines straight after a heading
      var body = [];
      while (j < lines.length && !SECTION_HEADING_RE.test(lines[j]) && !LABELLED_LINE_RE.test(lines[j])) {
        if (!lines[j].trim()) {
          // A blank line ends the section, unless more chorded lyrics follow straight after it
          // (documents that put an empty paragraph between every line).
          var k = j;
          while (k < lines.length && !lines[k].trim()) k++;
          if (k >= lines.length || lines[k].indexOf("[") === -1 || LABELLED_LINE_RE.test(lines[k]) || SECTION_HEADING_RE.test(lines[k])) break;
        }
        body.push(lines[j]);
        j++;
      }
      while (body.length && !body[body.length - 1].trim()) body.pop();
      if (!body.length) { out.push("{comment: " + label + "}"); i = j; continue; }
      if (kind === "chorus") {
        var key = lyricKey(body);
        if (firstChorusKey !== null && similar(key, firstChorusKey)) {
          // keep a note like "(Band in)" on the repeat: {chorus: Chorus (Band in)}
          out.push(m[3] ? "{chorus: " + label + "}" : "{chorus}");
          i = j;
          continue;
        }
        if (firstChorusKey === null) firstChorusKey = key;
      }
      out.push("{start_of_" + kind + ": " + label + "}");
      out = out.concat(body);
      out.push("{end_of_" + kind + "}");
      i = j;
    }
    return out.filter(function (l, idx) { return l.trim() || (idx > 0 && out[idx - 1].trim()); }); // no double blanks
  }

  // Word chord charts lean on tabs for alignment. Expanding them to fixed tab stops gives the
  // chord tokens real columns, matching how the PDF importer lays out text by x position.
  var TAB_WIDTH = 8;
  function expandTabs(line) {
    var out = "";
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (ch === "\t") out += new Array(TAB_WIDTH - (out.length % TAB_WIDTH) + 1).join(" ");
      else out += ch;
    }
    return out;
  }

  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, function (m, e) {
      var k = e.toLowerCase();
      if (k === "amp") return "&";
      if (k === "lt") return "<";
      if (k === "gt") return ">";
      if (k === "quot") return '"';
      if (k === "apos") return "'";
      if (k === "nbsp") return " ";
      if (k.charAt(1) === "x") return String.fromCharCode(parseInt(k.slice(2), 16));
      return String.fromCharCode(parseInt(k.slice(1), 10));
    });
  }

  // Turns mammoth.convertToHtml() output into the text shape convert() expects: one visual line
  // per "\n\n"-separated paragraph. Raw-text extraction can't be used for .docx because it drops
  // soft line breaks (Shift+Enter), fusing a chord line onto the lyric line below it. Here each
  // <br> becomes its own line, empty paragraphs stay as blank lines, and tabs are expanded.
  function docxHtmlToText(html) {
    var text = html
      .replace(/\r\n?/g, "\n")
      .replace(/<br\s*\/?>/gi, "\u0001")
      .replace(/<\/(p|h[1-6]|li|tr|div|blockquote)>/gi, "\u0002")
      .replace(/<[^>]*>/g, "");
    text = decodeEntities(text).replace(/ /g, " ");
    var lines = [];
    text.split("\u0002").forEach(function (para) {
      para.split("\u0001").forEach(function (line) {
        lines.push(expandTabs(line.replace(/\n/g, " ")).replace(/\s+$/, ""));
      });
    });
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    return lines.join("\n\n");
  }

  // labelled: "Intro: D G" style lines (true), plain chord lines (false); null if not a chord line.
  function chordLineKind(line) {
    var info = classify(line.replace(/\s+$/, ""));
    return info ? { labelled: info.prefixEnd > 0 } : null;
  }
  function isChordLine(line) { return !!chordLineKind(line); }

  return { convert: convert, docxHtmlToText: docxHtmlToText, isChordLine: isChordLine, chordLineKind: chordLineKind };
})();
