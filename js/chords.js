/* Chord symbol parsing, transposition, and fretboard diagrams. */

var ChordTheory = (function () {
  "use strict";

  var SHARP_SCALE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var FLAT_SCALE = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

  var NOTE_INDEX = {};
  SHARP_SCALE.forEach(function (n, i) { NOTE_INDEX[n] = i; });
  FLAT_SCALE.forEach(function (n, i) { NOTE_INDEX[n] = i; });
  NOTE_INDEX["E#"] = 5; NOTE_INDEX["B#"] = 0; NOTE_INDEX["Cb"] = 11; NOTE_INDEX["Fb"] = 4;

  // Matches a root note at the start of a chord symbol: A-G, optional # or b (not "bb").
  var ROOT_RE = /^([A-G])([#b]?)/;

  function parseChord(symbol) {
    var m = ROOT_RE.exec(symbol);
    if (!m) return null;
    var root = m[1] + m[2];
    var rest = symbol.slice(m[0].length);
    var bass = null;
    var slash = rest.indexOf("/");
    if (slash !== -1) {
      var bassPart = rest.slice(slash + 1);
      var bm = ROOT_RE.exec(bassPart);
      if (bm) {
        bass = bm[1] + bm[2];
        rest = rest.slice(0, slash) + bassPart.slice(bm[0].length);
      }
    }
    if (NOTE_INDEX[root] === undefined) return null;
    return { root: root, suffix: rest, bass: bass };
  }

  // Trailing slashes after a chord are beat marks, not a bass note: G#/ = 2 beats, G#/// = 4.
  // G/B is a real slash chord; G/B/ is G/B held for 2 beats.
  function splitBeats(symbol) {
    var m = /^(.*?)(\/+)$/.exec(symbol || "");
    return m && m[1] ? { chord: m[1], beats: m[2] } : { chord: symbol, beats: "" };
  }

  // True for a real chord name (not N.C., NC, or other text), ignoring beat marks.
  function isChord(symbol) {
    return !!parseChord(splitBeats(symbol).chord);
  }

  function transposeNote(note, steps, useFlats) {
    var idx = NOTE_INDEX[note];
    if (idx === undefined) return note;
    var newIdx = ((idx + steps) % 12 + 12) % 12;
    return useFlats ? FLAT_SCALE[newIdx] : SHARP_SCALE[newIdx];
  }

  // Transposes a full chord symbol (e.g. "C#maj7/G#"). Leaves non-chord text (annotations) untouched.
  // With steps 0 the chord is only respelled: "flats" turns F# into Gb even without a transpose
  // (it used to do nothing unless the song was also transposed or had a capo).
  function transposeChord(symbol, steps, useFlats) {
    if (!steps && !useFlats) return symbol;
    var b = splitBeats(symbol);
    if (b.beats) return transposeChord(b.chord, steps, useFlats) + b.beats;
    var parsed = parseChord(symbol);
    if (!parsed) return symbol;
    var newRoot = transposeNote(parsed.root, steps, useFlats);
    var out = newRoot + parsed.suffix;
    if (parsed.bass) out += "/" + transposeNote(parsed.bass, steps, useFlats);
    return out;
  }

  // ---------- Scale-degree notation (Nashville numbers / Roman numerals) ----------
  // Degrees are measured in semitones from the song's key, so they don't change with transpose
  // or capo - which is the point of numbers. A degree outside the major scale gets a b or #.
  var DEGREE_BY_SEMITONE = ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"];
  // In a minor key, count from the minor scale, so in A minor C is 3 (III) and G is 7 (VII).
  var DEGREE_BY_SEMITONE_MINOR = ["1", "b2", "2", "3", "#3", "4", "b5", "5", "6", "#6", "7", "#7"];
  var ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII"];

  function noteIndex(note) { return NOTE_INDEX[note]; }

  // Splits a chord suffix into its quality and the rest: "m7" -> minor + "7", "dim7" -> dim + "7".
  function splitQuality(suffix) {
    var m;
    if ((m = /^(m7b5|m7\(b5\)|ø7?)/.exec(suffix))) return { quality: "halfdim", rest: (/7/.test(m[0]) ? "7" : "") + suffix.slice(m[0].length) };
    if ((m = /^(dim|°|o(?=\d|$))/.exec(suffix))) return { quality: "dim", rest: suffix.slice(m[0].length) };
    if ((m = /^(aug|\+)/.exec(suffix))) return { quality: "aug", rest: suffix.slice(m[0].length) };
    if ((m = /^(min|mi|m(?!aj)|-)/.exec(suffix))) return { quality: "minor", rest: suffix.slice(m[0].length) };
    return { quality: "major", rest: suffix };
  }

  function degreeOf(note, keyIdx, minorKey) {
    var idx = NOTE_INDEX[note];
    if (idx === undefined) return null;
    return (minorKey ? DEGREE_BY_SEMITONE_MINOR : DEGREE_BY_SEMITONE)[((idx - keyIdx) % 12 + 12) % 12];
  }

  function romanOf(degree, lower) {
    var acc = degree.length > 1 ? degree.charAt(0) : "";
    var r = ROMAN[parseInt(degree.slice(acc.length), 10)];
    return acc + (lower ? r.toLowerCase() : r);
  }

  function escSup(s) {
    // extensions such as 7, sus4, add9 go in superscript, the usual way numbers charts show them
    return s ? '<sup class="chord-ext">' + escapeHtml(s) + "</sup>" : "";
  }

  // Best-fitting major key for a list of chord symbols (used when a song has no {key:}): each
  // chord scores for being in the key's scale, more when its quality fits that degree (major on
  // 1/4/5, minor on 2/3/6); ties go to the key whose 1 chord appears most.
  function guessKey(symbols) {
    var MAJOR_STEPS = { 0: "major", 2: "minor", 4: "minor", 5: "major", 7: "major", 9: "minor", 11: "dim" };
    var best = null, bestScore = -1, bestTonic = -1;
    for (var k = 0; k < 12; k++) {
      var score = 0, tonic = 0;
      symbols.forEach(function (sym) {
        var p = parseChord(sym);
        if (!p) return;
        var step = ((NOTE_INDEX[p.root] - k) % 12 + 12) % 12;
        if (!(step in MAJOR_STEPS)) return;
        var q = splitQuality(p.suffix).quality;
        score += (q === MAJOR_STEPS[step] || /^sus|^5|^2|^4/.test(p.suffix)) ? 2 : 1;
        if (step === 0) tonic++;
      });
      if (score > bestScore || (score === bestScore && tonic > bestTonic)) { best = k; bestScore = score; bestTonic = tonic; }
    }
    return bestScore > 0 ? best : null;
  }

  // Returns HTML for a chord in "nashville" or "roman" style, relative to keyIdx (0-11), or null
  // when the symbol isn't a chord this can read (left as written by the caller).
  // Secondary dominants (Roman numerals only): a chord that isn't in the key and resolves a fifth
  // down to a chord that is, is written V/target - D7 -> G in C is V7/V, E7 -> Am is V7/vi. A
  // diminished chord resolving up a half step is vii°/target. The target keeps its own case
  // (lowercase = minor). It's only labelled when the next chord really is that target; otherwise
  // the chord gets its plain numeral (II7, bVII...). Returns null when it isn't one.
  var NAMES = ["one", "two", "three", "four", "five", "six", "seven"];
  function secondaryDominant(parsed, nextSymbol, keyIdx, minorKey) {
    if (!nextSymbol || parsed.bass) return null;
    var next = parseChord(splitBeats(nextSymbol).chord);
    if (!next) return null;
    var q = splitQuality(parsed.suffix);
    var nq = splitQuality(next.suffix);
    if (nq.quality === "dim" || nq.quality === "halfdim" || nq.quality === "aug") return null;
    var rel = ((NOTE_INDEX[parsed.root] - keyIdx) % 12 + 12) % 12;
    var step = ((NOTE_INDEX[next.root] - NOTE_INDEX[parsed.root]) % 12 + 12) % 12;
    var head;
    if (q.quality === "major" && /^(7|9|13)?$/.test(q.rest)) {
      if (step !== 5) return null; // a dominant resolves down a fifth
      var diatonicMajor = minorKey ? { 3: 1, 7: 1, 8: 1, 10: 1 } : { 0: 1, 5: 1, 7: 1 };
      if (q.rest === "" && diatonicMajor[rel]) return null; // plain chord of the key
      if (q.rest !== "" && rel === 7) return null;          // the key's own V7
      head = "V";
    } else if (q.quality === "dim" || q.quality === "halfdim") {
      if (step !== 1) return null; // a leading-tone chord resolves up a half step
      if (rel === (minorKey ? 2 : 11)) return null; // the key's own diminished chord
      head = "vii" + (q.quality === "dim" ? "°" : "ø");
    } else {
      return null;
    }
    var tDeg = degreeOf(next.root, keyIdx, minorKey);
    if (!/^[2-7]$/.test(tDeg)) return null; // target must be a chord of the key, other than I
    var target = romanOf(tDeg, nq.quality === "minor");
    var tip = parsed.root + parsed.suffix + " \u2192 " + next.root + next.suffix + ": " +
      (head === "V" ? "five" : "seven") + " of " + NAMES[parseInt(tDeg, 10) - 1] + " (secondary " + (head === "V" ? "dominant" : "leading-tone chord") + ")";
    return '<span class="secondary-dom" title="' + escapeHtml(tip) + '">' + escapeHtml(head) + escSup(q.rest) + "/" + escapeHtml(target) + "</span>";
  }

  // minorMark: how Nashville writes a minor chord, "m" (6m, the default) or "-" (6-).
  // nextSymbol: the chord that follows, used to spot secondary dominants in Roman numerals.
  function formatDegree(symbol, keyIdx, style, minorKey, minorMark, nextSymbol) {
    var b = splitBeats(symbol);
    if (b.beats) {
      var inner = formatDegree(b.chord, keyIdx, style, minorKey, minorMark, nextSymbol);
      return inner === null ? null : inner + escapeHtml(b.beats);
    }
    var parsed = parseChord(symbol);
    if (!parsed || keyIdx == null) return null;
    if (style === "roman") {
      var sec = secondaryDominant(parsed, nextSymbol, keyIdx, minorKey);
      if (sec) return sec;
    }
    var degree = degreeOf(parsed.root, keyIdx, minorKey);
    var q = splitQuality(parsed.suffix);
    var out;
    if (style === "roman") {
      var lower = q.quality === "minor" || q.quality === "dim" || q.quality === "halfdim";
      out = escapeHtml(romanOf(degree, lower));
      if (q.quality === "dim") out += "°";
      else if (q.quality === "halfdim") out += "ø";
      else if (q.quality === "aug") out += "+";
      out += escSup(q.rest);
    } else {
      out = escapeHtml(degree);
      if (q.quality === "minor") out += minorMark === "-" ? "-" : "m";
      else if (q.quality === "dim") out += "°";
      else if (q.quality === "halfdim") out += "ø";
      else if (q.quality === "aug") out += "+";
      out += escSup(q.rest);
    }
    if (parsed.bass) {
      // Bass note's scale degree: a number in Nashville (5/7), an uppercase numeral in Roman (I/III)
      var bassDeg = degreeOf(parsed.bass, keyIdx, minorKey);
      if (style === "roman") {
        // tooltip spells it out, since V/IV can also be a secondary dominant
        out = '<span class="bass-slash" title="' + escapeHtml(parsed.root + parsed.suffix + "/" + parsed.bass + ": " + bassDeg + " in the bass") + '">' +
          out + "/" + escapeHtml(romanOf(bassDeg, false)) + "</span>";
      } else {
        out += "/" + escapeHtml(bassDeg);
      }
    }
    return out;
  }

  // Well-known open-position chord shapes, kept deliberately small: only shapes that are
  // standard and unambiguous. Anything not listed renders as a text-only chip rather than a
  // guessed diagram.

  // Guitar (standard tuning E A D G B e), low to high. "x" = muted, 0 = open.
  var GUITAR_DIAGRAM_DICTIONARY = {
    "C": ["x", 3, 2, 0, 1, 0], "Cmaj7": ["x", 3, 2, 0, 0, 0], "C7": ["x", 3, 2, 3, 1, 0], "Cm": ["x", 3, 5, 5, 4, 3],
    "D": ["x", "x", 0, 2, 3, 2], "Dmaj7": ["x", "x", 0, 2, 2, 2], "D7": ["x", "x", 0, 2, 1, 2], "Dm": ["x", "x", 0, 2, 3, 1], "Dm7": ["x", "x", 0, 2, 1, 1],
    "E": [0, 2, 2, 1, 0, 0], "Emaj7": [0, 2, 1, 1, 0, 0], "E7": [0, 2, 0, 1, 0, 0], "Em": [0, 2, 2, 0, 0, 0], "Em7": [0, 2, 0, 0, 0, 0],
    "F": [1, 3, 3, 2, 1, 1], "Fmaj7": ["x", "x", 3, 2, 1, 0], "F7": [1, 3, 1, 2, 1, 1], "Fm": [1, 3, 3, 1, 1, 1],
    "G": [3, 2, 0, 0, 0, 3], "Gmaj7": [3, 2, 0, 0, 0, 2], "G7": [3, 2, 0, 0, 0, 1], "Gm": [3, 5, 5, 3, 3, 3],
    "A": ["x", 0, 2, 2, 2, 0], "Amaj7": ["x", 0, 2, 1, 2, 0], "A7": ["x", 0, 2, 0, 2, 0], "Am": ["x", 0, 2, 2, 1, 0], "Am7": ["x", 0, 2, 0, 1, 0],
    "B7": ["x", 2, 1, 2, 0, 2], "Bm": ["x", 2, 4, 4, 3, 2], "B": ["x", 2, 4, 4, 4, 2],
    "Asus4": ["x", 0, 2, 2, 3, 0], "Dsus4": ["x", "x", 0, 2, 3, 3], "Esus4": [0, 2, 2, 2, 0, 0],
    "Csus4": ["x", 3, 3, 0, 1, 1], "Gsus4": [3, 3, 0, 0, 1, 3],
    "Dsus2": ["x", "x", 0, 2, 3, 0], "Cadd9": ["x", 3, 2, 0, 3, 0], "Asus2": ["x", 0, 2, 2, 0, 0]
  };

  // Ukulele (standard reentrant tuning G C E A), low-pitched-string-first by position, not pitch.
  // Every root (including the sharps/flats) verified against ukutabs.com's mandolin/ukulele
  // chord-diagram reference pages - these are real published fingerings, not derived or guessed.
  var UKULELE_DIAGRAM_DICTIONARY = {
    "C": [0, 0, 0, 3], "C7": [0, 0, 0, 1], "Cmaj7": [0, 0, 0, 2], "Cm": [0, 3, 3, 3], "Cm7": [3, 3, 3, 3],
    "C#": [1, 1, 1, 4], "C#7": [1, 1, 1, 2], "C#maj7": [1, 0, 1, 4], "C#m": [1, 1, 0, 4], "C#m7": [1, 1, 0, 2],
    "Db": [1, 1, 1, 4], "Db7": [1, 1, 1, 2], "Dbmaj7": [1, 0, 1, 4], "Dbm": [1, 1, 0, 4], "Dbm7": [1, 1, 0, 2],
    "D": [2, 2, 2, 0], "D7": [2, 2, 2, 3], "Dmaj7": [2, 2, 2, 4], "Dm": [2, 2, 1, 0], "Dm7": [2, 2, 1, 3],
    "D#": [0, 3, 3, 1], "D#7": [0, 3, 6, 4], "D#maj7": [8, 7, 6, 5], "D#m": [3, 3, 2, 1], "D#m7": [3, 3, 2, 4],
    "Eb": [0, 3, 3, 1], "Eb7": [0, 3, 6, 4], "Ebmaj7": [8, 7, 6, 5], "Ebm": [3, 3, 2, 1], "Ebm7": [3, 3, 2, 4],
    "E": [1, 4, 0, 2], "E7": [1, 2, 0, 2], "Emaj7": [1, 3, 0, 2], "Em": [0, 4, 3, 2], "Em7": [0, 2, 0, 2],
    "F": [2, 0, 1, 0], "F7": [2, 3, 1, 3], "Fmaj7": [2, 4, 1, 3], "Fm": [1, 0, 1, 3], "Fm7": [1, 3, 1, 3],
    "F#": [3, 1, 2, 1], "F#7": [3, 6, 0, 4], "F#maj7": [3, 5, 2, 4], "F#m": [2, 1, 2, 0], "F#m7": [6, 6, 0, 0],
    "Gb": [3, 1, 2, 1], "Gb7": [3, 6, 0, 4], "Gbmaj7": [3, 5, 2, 4], "Gbm": [2, 1, 2, 0], "Gbm7": [6, 6, 0, 0],
    "G": [0, 2, 3, 2], "G7": [0, 2, 1, 2], "Gmaj7": [0, 2, 2, 2], "Gm": [0, 2, 3, 1], "Gm7": [0, 2, 1, 1],
    "G#": [5, 3, 4, 3], "G#7": [1, 3, 2, 3], "G#maj7": [1, 3, 3, 3], "G#m": [1, 3, 4, 2], "G#m7": [1, 3, 2, 2],
    "Ab": [5, 3, 4, 3], "Ab7": [1, 3, 2, 3], "Abmaj7": [1, 3, 3, 3], "Abm": [1, 3, 4, 2], "Abm7": [1, 3, 2, 2],
    "A": [2, 1, 0, 0], "A7": [0, 1, 0, 0], "Amaj7": [1, 1, 0, 0], "Am": [2, 0, 0, 0], "Am7": [0, 0, 0, 0],
    "Bb": [3, 2, 1, 1], "Bb7": [1, 2, 1, 1], "Bbmaj7": [3, 2, 1, 0], "Bbm": [3, 1, 1, 1], "Bbm7": [1, 1, 1, 1],
    "A#": [3, 2, 1, 1], "A#7": [1, 2, 1, 1], "A#maj7": [3, 2, 1, 0], "A#m": [3, 1, 1, 1], "A#m7": [1, 1, 1, 1],
    "B": [4, 3, 2, 2], "B7": [2, 3, 2, 2], "Bmaj7": [4, 3, 2, 1], "Bm": [4, 2, 2, 2], "Bm7": [2, 2, 2, 2]
  };

  // Mandolin (standard tuning G D A E, same string order as the arrays). Shapes are found by
  // search rather than by sliding one fixed shape: for each chord, every fingering where each
  // string sounds a chord tone is tried, keeping those that contain the root, third and (for
  // seventh chords) the seventh, with all fretted notes inside a 4-fret window. The lowest-
  // position, smallest-stretch result wins. This reproduces the standard open shapes
  // (C 0230, G 0023, D 2002, Cm 0133) and gives movable shapes elsewhere, never a stretch.
  var MANDOLIN_DIAGRAM_DICTIONARY = {}; // filled by fillBySearch below

  // Chord tones as semitones above the root; required ones must all be present.
  var SEARCH_QUALITIES = {
    "": { tones: [0, 4, 7], required: [0, 4, 7] },
    "m": { tones: [0, 3, 7], required: [0, 3, 7] },
    "7": { tones: [0, 4, 7, 10], required: [0, 4, 10] },
    "m7": { tones: [0, 3, 7, 10], required: [0, 3, 10] },
    "maj7": { tones: [0, 4, 7, 11], required: [0, 4, 11] },
    "sus2": { tones: [0, 2, 7], required: [0, 2, 7] },
    "sus4": { tones: [0, 5, 7], required: [0, 5, 7] },
    "7sus4": { tones: [0, 5, 7, 10], required: [0, 5, 10] },
    "6": { tones: [0, 4, 7, 9], required: [0, 4, 9] },
    "m6": { tones: [0, 3, 7, 9], required: [0, 3, 9] },
    "dim": { tones: [0, 3, 6], required: [0, 3, 6] },
    "dim7": { tones: [0, 3, 6, 9], required: [0, 3, 6, 9] },
    "m7b5": { tones: [0, 3, 6, 10], required: [0, 3, 6, 10] },
    "aug": { tones: [0, 4, 8], required: [0, 4, 8] },
    "add9": { tones: [0, 2, 4, 7], required: [0, 2, 4] },
    "9": { tones: [0, 2, 4, 7, 10], required: [0, 2, 4, 10] },
    "5": { tones: [0, 7], required: [0, 7] }
  };
  var SEARCH_ROOTS = [
    ["C"], ["C#", "Db"], ["D"], ["D#", "Eb"], ["E"], ["F"],
    ["F#", "Gb"], ["G"], ["G#", "Ab"], ["A"], ["A#", "Bb"], ["B"]
  ];

  // Fills every root x quality missing from dict with the best searched shape for these open strings.
  function fillBySearch(dict, OPEN_STRINGS) {
    var MAX_FRET = 12;
    function bestShape(root, q) {
      var toneSet = {};
      q.tones.forEach(function (t) { toneSet[(root + t) % 12] = true; });
      var options = OPEN_STRINGS.map(function (open) {
        var frets = [];
        for (var f = 0; f <= MAX_FRET; f++) if (toneSet[(open + f) % 12]) frets.push(f);
        return frets;
      });
      var best = null, bestScore = null;
      (function walk(i, shape) {
        if (i === OPEN_STRINGS.length) {
          var fretted = shape.filter(function (f) { return f > 0; });
          var lo = fretted.length ? Math.min.apply(null, fretted) : 0;
          var hi = fretted.length ? Math.max.apply(null, fretted) : 0;
          if (hi - lo > 3) return;
          var have = {};
          shape.forEach(function (f, s) { have[(OPEN_STRINGS[s] + f - root + 24) % 12] = true; });
          for (var r = 0; r < q.required.length; r++) if (!have[q.required[r]]) return;
          var sum = shape.reduce(function (a, b) { return a + b; }, 0);
          var score = [hi, hi - lo, sum];
          if (!bestScore || score[0] < bestScore[0] || (score[0] === bestScore[0] &&
              (score[1] < bestScore[1] || (score[1] === bestScore[1] && score[2] < bestScore[2])))) {
            best = shape.slice(); bestScore = score;
          }
          return;
        }
        options[i].forEach(function (f) { shape.push(f); walk(i + 1, shape); shape.pop(); });
      })(0, []);
      return best;
    }

    for (var r = 0; r < 12; r++) {
      Object.keys(SEARCH_QUALITIES).forEach(function (quality) {
        var names = SEARCH_ROOTS[r].filter(function (n) { return !dict[n + quality]; });
        if (!names.length) return;
        var shape = bestShape(r, SEARCH_QUALITIES[quality]);
        if (shape) names.forEach(function (name) { dict[name + quality] = shape; });
      });
    }
  }

  // Movable barre-chord shapes - slide the open E and A shapes above up the neck. These are
  // standard textbook fingerings, not guesses, so they can safely cover every root the open
  // shapes above don't already have. Only fills in names that aren't already listed.
  // Every quality has an A-string-root shape; most also have an E-string-root one. For each
  // chord the lower of the two positions wins (fret 0 = the open shape itself).
  var E_SHAPE = {
    "": [0, 2, 2, 1, 0, 0], "m": [0, 2, 2, 0, 0, 0], "7": [0, 2, 0, 1, 0, 0], "m7": [0, 2, 0, 0, 0, 0], "maj7": [0, 2, 1, 1, 0, 0],
    "sus4": [0, 2, 2, 2, 0, 0], "7sus4": [0, 2, 0, 2, 0, 0], "6": [0, 2, 2, 1, 2, 0], "m6": [0, 2, 2, 0, 2, 0],
    "5": [0, 2, 2, "x", "x", "x"], "dim": [0, 1, 2, 0, "x", "x"], "dim7": [0, 1, 2, 0, 2, 0], "m7b5": [0, 1, 2, 0, 3, 0],
    "aug": [0, 3, 2, 1, 1, 0], "9": [0, 2, 0, 1, 0, 2], "add9": [0, "x", 2, 1, 0, 2]
  };
  var A_SHAPE = {
    "": ["x", 0, 2, 2, 2, 0], "m": ["x", 0, 2, 2, 1, 0], "7": ["x", 0, 2, 0, 2, 0], "m7": ["x", 0, 2, 0, 1, 0], "maj7": ["x", 0, 2, 1, 2, 0],
    "sus4": ["x", 0, 2, 2, 3, 0], "7sus4": ["x", 0, 2, 0, 3, 0], "sus2": ["x", 0, 2, 2, 0, 0], "6": ["x", 0, 2, 2, 2, 2], "m6": ["x", 0, 2, 2, 1, 2],
    "5": ["x", 0, 2, 2, "x", "x"], "dim": ["x", 0, 1, 2, 1, "x"], "dim7": ["x", 0, 1, 2, 1, 2], "m7b5": ["x", 0, 1, 0, 1, "x"],
    "aug": ["x", 0, 3, 2, 2, 1], "9": ["x", 0, -1, 0, 0, 0], "add9": ["x", 0, 2, 4, 2, 0]
  };

  (function addBarreChords() {
    var eRootIdx = NOTE_INDEX["E"], aRootIdx = NOTE_INDEX["A"];
    for (var i = 0; i < 12; i++) {
      var names = [SHARP_SCALE[i]];
      if (FLAT_SCALE[i] !== SHARP_SCALE[i]) names.push(FLAT_SCALE[i]);
      var eFret = (i - eRootIdx + 12) % 12;
      var aFret = (i - aRootIdx + 12) % 12;
      Object.keys(A_SHAPE).forEach(function (quality) {
        var candidates = [];
        if (E_SHAPE[quality]) candidates.push({ fret: eFret, shape: E_SHAPE[quality] });
        candidates.push({ fret: aFret, shape: A_SHAPE[quality] });
        // A shape with a note below the root's fret (A9 = x,0,-1,0,0,0) needs room below it.
        candidates = candidates.filter(function (c) {
          return c.shape.every(function (f) { return f === "x" || f + c.fret >= 0; });
        });
        // Lowest position wins, but a 4-fret stretch only if nothing else fits.
        function cost(c) {
          var fr = c.shape.filter(function (f) { return f !== "x" && f + c.fret > 0; })
            .map(function (f) { return f + c.fret; });
          var span = fr.length ? Math.max.apply(null, fr) - Math.min.apply(null, fr) : 0;
          return c.fret + (span > 3 ? 12 : 0);
        }
        candidates.sort(function (a, b) { return cost(a) - cost(b); });
        var chosen = candidates[0];
        var shape = chosen.shape.map(function (f) { return f === "x" ? "x" : f + chosen.fret; });
        names.forEach(function (root) {
          var name = root + quality;
          if (!GUITAR_DIAGRAM_DICTIONARY[name]) GUITAR_DIAGRAM_DICTIONARY[name] = shape;
        });
      });
    }
  })();

  var INSTRUMENT_DICTIONARIES = { guitar: GUITAR_DIAGRAM_DICTIONARY, ukulele: UKULELE_DIAGRAM_DICTIONARY, mandolin: MANDOLIN_DIAGRAM_DICTIONARY };
  var INSTRUMENT_STRING_COUNT = { guitar: 6, ukulele: 4, mandolin: 4 };

  // A chord with no open string is a barre/movable shape - its diagram starts at its own lowest
  // fret. A shape with open strings sits at the nut, unless its fretted notes reach past the 4th
  // fret (e.g. ukulele F#m7 6600): then it shifts up to them and keeps the open-string markers,
  // so no dot is ever drawn off the grid.
  function computeBaseFret(frets) {
    var fretted = frets.filter(function (f) { return typeof f === "number" && f > 0; });
    if (!fretted.length) return 1;
    if (frets.indexOf(0) !== -1 && Math.max.apply(null, fretted) <= 4) return 1;
    return Math.min.apply(null, fretted);
  }

  // Ukulele: hand-checked shapes above first, then searched shapes for everything else.
  fillBySearch(UKULELE_DIAGRAM_DICTIONARY, [7, 0, 4, 9]); // G C E A
  fillBySearch(MANDOLIN_DIAGRAM_DICTIONARY, [7, 2, 9, 4]); // G D A E

  // Different ways of writing the same chord quality -> the dictionary's spelling.
  var SUFFIX_ALIASES = [
    [/^(M|maj|Maj|major)?$/, ""],
    [/^(m|min|mi|-)$/, "m"],
    [/^(maj7|Maj7|M7|ma7|j7|Δ7?)$/, "maj7"],
    [/^(m7|min7|mi7|-7)$/, "m7"],
    [/^(m6|min6|mi6|-6)$/, "m6"],
    [/^(m7b5|min7b5|mi7b5|-7b5|ø7?)$/, "m7b5"],
    [/^(dim7|°7|o7)$/, "dim7"],
    [/^(dim|°|o)$/, "dim"],
    [/^(aug|\+|\+5|#5)$/, "aug"],
    [/^(sus|sus4|4)$/, "sus4"],
    [/^(sus2|2|2no3|sus2no3)$/, "sus2"],
    [/^(7sus|7sus4)$/, "7sus4"],
    [/^(add9|add2)$/, "add9"]
  ];

  // Looks up a diagram for any spelling of a chord: beat marks (G#/) and a bass note (G/B) are
  // ignored, since the shape is the base chord's; aliases (Cmin, C-, Bbo) and enharmonic roots
  // (A# / Bb) are tried. N.C. and other text return null.
  function diagramFor(chordSymbol, instrument) {
    var dict = INSTRUMENT_DICTIONARIES[instrument] || GUITAR_DIAGRAM_DICTIONARY;
    var parsed = parseChord(splitBeats(chordSymbol).chord);
    if (!parsed) return null;
    var suffix = parsed.suffix.replace(/[()\s]/g, "");
    for (var i = 0; i < SUFFIX_ALIASES.length; i++) {
      if (SUFFIX_ALIASES[i][0].test(suffix)) { suffix = SUFFIX_ALIASES[i][1]; break; }
    }
    var idx = NOTE_INDEX[parsed.root];
    var frets = dict[parsed.root + suffix] || dict[SHARP_SCALE[idx] + suffix] || dict[FLAT_SCALE[idx] + suffix];
    if (!frets) return null;
    return { frets: frets, baseFret: computeBaseFret(frets) };
  }

  function renderDiagramSVG(name, def) {
    if (!def) return "";
    var frets = def.frets, baseFret = def.baseFret || 1;
    var strings = frets.length;
    var maxFret = 0;
    frets.forEach(function (f) { if (typeof f === "number" && f > maxFret) maxFret = f; });
    var numFrets = Math.max(4, maxFret - baseFret + 1); // grow rather than clip a wide shape
    var w = 70, left = 10, top = 30, stringGap = (w - 2 * left) / (strings - 1), fretGap = 14;
    var h = top + numFrets * fretGap + 8;
    var svg = '<svg class="chord-diagram" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">';
    // Chord name: 13px, shrunk just enough for long names (Db2(no3), A#m7b5/C#) to fit the width.
    var nameSize = name.length > 8 ? Math.max(9, Math.floor(13 * 8 / name.length)) : 13;
    svg += '<text x="' + (w / 2) + '" y="14" class="cd-name" text-anchor="middle" style="font-size:' + nameSize + 'px">' + escapeHtml(name) + "</text>";
    if (baseFret > 1) {
      svg += '<text x="2" y="' + (top + fretGap / 2 + 3) + '" class="cd-basefret">' + baseFret + "fr</text>";
    }
    // strings
    for (var s = 0; s < strings; s++) {
      var x = left + s * stringGap;
      svg += '<line x1="' + x + '" y1="' + top + '" x2="' + x + '" y2="' + (top + numFrets * fretGap) + '" class="cd-line"/>';
    }
    // frets
    for (var f = 0; f <= numFrets; f++) {
      var y = top + f * fretGap;
      var strokeWidth = (f === 0 && baseFret === 1) ? 3 : 1;
      svg += '<line x1="' + left + '" y1="' + y + '" x2="' + (w - left) + '" y2="' + y + '" class="cd-line" stroke-width="' + strokeWidth + '"/>';
    }
    // markers
    for (var i = 0; i < strings; i++) {
      var val = frets[i];
      var x2 = left + i * stringGap;
      if (val === "x" || val === "X") {
        svg += '<text x="' + x2 + '" y="' + (top - 6) + '" class="cd-mute" text-anchor="middle">&times;</text>';
      } else if (val === 0) {
        svg += '<circle cx="' + x2 + '" cy="' + (top - 6) + '" r="3" class="cd-open"/>';
      } else if (typeof val === "number") {
        var relFret = val - baseFret + 1;
        var cy = top + (relFret - 0.5) * fretGap;
        svg += '<circle cx="' + x2 + '" cy="' + cy + '" r="5" class="cd-dot"/>';
      }
    }
    svg += "</svg>";
    return svg;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  return {
    parseChord: parseChord,
    splitBeats: splitBeats,
    isChord: isChord,
    transposeChord: transposeChord,
    noteIndex: noteIndex,
    formatDegree: formatDegree,
    guessKey: guessKey,
    SHARP_SCALE: SHARP_SCALE,
    diagramFor: diagramFor,
    renderDiagramSVG: renderDiagramSVG,
    INSTRUMENT_STRING_COUNT: INSTRUMENT_STRING_COUNT,
    GUITAR_DIAGRAM_DICTIONARY: GUITAR_DIAGRAM_DICTIONARY,
    UKULELE_DIAGRAM_DICTIONARY: UKULELE_DIAGRAM_DICTIONARY,
    MANDOLIN_DIAGRAM_DICTIONARY: MANDOLIN_DIAGRAM_DICTIONARY
  };
})();
