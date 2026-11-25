/* Instrument detection: an {x_instrument:} directive, or a comment that names the instrument. */

var ChordInstruments = (function () {
  "use strict";

  var DEFS = {
    guitar: { label: "Guitar", strings: 6, aliases: ["guitar", "gtr", "chord", "chords", "standard"] },
    ukulele: { label: "Ukulele", strings: 4, aliases: ["ukulele", "uke", "ukelele"] },
    mandolin: { label: "Mandolin", strings: 4, aliases: ["mandolin", "mando"] }
  };

  var ALIAS_LOOKUP = {};
  Object.keys(DEFS).forEach(function (key) {
    DEFS[key].aliases.forEach(function (a) { ALIAS_LOOKUP[a] = key; });
  });

  var WORD_RE = /[a-z]+/gi;

  // Whole-word, case-insensitive match against the known instrument aliases.
  function detectFromText(text) {
    if (!text) return null;
    WORD_RE.lastIndex = 0;
    var m;
    while ((m = WORD_RE.exec(text))) {
      var hit = ALIAS_LOOKUP[m[0].toLowerCase()];
      if (hit) return hit;
    }
    return null;
  }

  var COMMENT_DIRECTIVES = { comment: true, comment_italic: true, comment_box: true, highlight: true };

  // Walks a parsed-AST node list (ChordProParser output) for the first instrument hint:
  // an {x_instrument:} directive, a comment directive, or a raw "#" comment line.
  function detectFromAst(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.type === "directive") {
        if (n.name === "x_instrument") {
          var found = detectFromText(n.value);
          if (found) return found;
        } else if (COMMENT_DIRECTIVES[n.name]) {
          var found2 = detectFromText(n.value);
          if (found2) return found2;
        }
      } else if (n.type === "comment-line") {
        var found3 = detectFromText(n.raw.replace(/^\s*#/, ""));
        if (found3) return found3;
      } else if (n.type === "environment") {
        var inner = detectFromAst(n.children);
        if (inner) return inner;
      }
    }
    return null;
  }

  return { DEFS: DEFS, detectFromText: detectFromText, detectFromAst: detectFromAst };
})();
