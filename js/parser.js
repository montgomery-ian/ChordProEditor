/* ChordPro source -> AST. No rendering here, just structure. */

var ChordProParser = (function () {
  "use strict";

  var DIRECTIVE_LINE_RE = /^\s*\{\s*([^:}\s]+)\s*(?::\s*|\s+)?([^}]*)\}\s*$/;
  var INLINE_CHORD_RE = /\[([^\]]*)\]/g;

  function parseDirectiveToken(raw) {
    // raw like "start_of_verse-soprano!" or "comment" or "define-ukulele"
    var negated = false;
    var name = raw;
    if (name.indexOf("-") !== -1) {
      var parts = name.split("-");
      name = parts.shift();
      var selector = parts.join("-");
      if (selector.charAt(selector.length - 1) === "!") {
        negated = true;
        selector = selector.slice(0, -1);
      }
      return { name: name, selector: selector, negated: negated };
    }
    return { name: name, selector: null, negated: false };
  }

  // Parses "src=\"a.jpg\" scale=\"50%\"" style attribute strings into an object.
  function parseAttrs(str) {
    var attrs = {};
    var re = /(\w[\w-]*)\s*=\s*"([^"]*)"|(\w[\w-]*)\s*=\s*(\S+)/g;
    var m;
    var found = false;
    while ((m = re.exec(str))) {
      found = true;
      if (m[1]) attrs[m[1]] = m[2];
      else attrs[m[3]] = m[4];
    }
    return found ? attrs : null;
  }

  function parseDirectiveLine(line) {
    var m = DIRECTIVE_LINE_RE.exec(line);
    if (!m) return null;
    var tok = parseDirectiveToken(m[1]);
    var canonical = ChordProDirectives.canonicalize(tok.name);
    var valueRaw = (m[2] || "").trim();
    var attrs = parseAttrs(valueRaw);
    return {
      type: "directive",
      rawName: tok.name,
      name: canonical,
      selector: tok.selector,
      negated: tok.negated,
      value: valueRaw,
      attrs: attrs
    };
  }

  function parseLyricLine(line) {
    INLINE_CHORD_RE.lastIndex = 0;
    var matches = [];
    var m;
    while ((m = INLINE_CHORD_RE.exec(line))) matches.push(m);

    if (matches.length === 0) {
      return { type: "line", cells: [{ chord: null, text: line }], raw: line };
    }

    var cells = [];
    var pos = 0;
    for (var i = 0; i < matches.length; i++) {
      var match = matches[i];
      var textBefore = line.slice(pos, match.index); // only ever non-empty when i === 0
      var bracketContent = match[1];
      var nextStart = match.index + match[0].length;
      var afterEnd = (i + 1 < matches.length) ? matches[i + 1].index : line.length;
      var textAfter = line.slice(nextStart, afterEnd);

      if (textBefore) cells.push({ chord: null, text: textBefore });

      if (bracketContent.charAt(0) === "*") {
        cells.push({ chord: null, annotation: bracketContent.slice(1), text: textAfter });
      } else {
        cells.push({ chord: bracketContent, text: textAfter });
      }
      pos = afterEnd;
    }
    return { type: "line", cells: cells, raw: line };
  }

  function tokenize(source) {
    var lines = source.split(/\r\n|\r|\n/);
    var nodes = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^\s*#/.test(line)) {
        nodes.push({ type: "comment-line", raw: line });
      } else if (line.trim() === "") {
        nodes.push({ type: "empty" });
      } else if (/^\s*\{.*\}\s*$/.test(line)) {
        var d = parseDirectiveLine(line);
        nodes.push(d || parseLyricLine(line));
      } else {
        nodes.push(parseLyricLine(line));
      }
      nodes[nodes.length - 1].srcLine = i; // source line number, used for synchronized scrolling
    }
    return nodes;
  }

  // Groups start_of_X / end_of_X directive pairs (and the dedicated short aliases already
  // canonicalized to start_of_x/end_of_x) into environment container nodes. Lenient: an
  // environment left open at EOF is auto-closed.
  function groupEnvironments(nodes) {
    var root = { type: "root", children: [] };
    var stack = [root];

    function currentEnv() { return stack[stack.length - 1]; }

    // Inside a tab/grid/delegated raw environment, lines are kept verbatim (no chord parsing).
    var RAW_ENVS = { tab: true, grid: true, abc: true, ly: true, svg: true, textblock: true };

    nodes.forEach(function (node) {
      if (node.type === "directive" && /^start_of_/.test(node.name)) {
        var envName = node.name.replace(/^start_of_/, "");
        var label = (node.attrs && node.attrs.label) || (!node.attrs && node.value) || null;
        var env = { type: "environment", name: envName, label: label, selector: node.selector, negated: node.negated, children: [], srcLine: node.srcLine };
        currentEnv().children.push(env);
        stack.push(env);
        return;
      }
      if (node.type === "directive" && /^end_of_/.test(node.name)) {
        var closeName = node.name.replace(/^end_of_/, "");
        // pop until matching env name found, or just pop one level if no match (lenient)
        for (var i = stack.length - 1; i > 0; i--) {
          if (stack[i].type === "environment" && stack[i].name === closeName) {
            stack.length = i;
            return;
          }
        }
        if (stack.length > 1) stack.pop();
        return;
      }
      var env = currentEnv();
      if (env.type === "environment" && RAW_ENVS[env.name] && node.type === "line") {
        node.raw_only = true;
      }
      env.children.push(node);
    });

    return root;
  }

  function parse(source) {
    return groupEnvironments(tokenize(source));
  }

  return {
    parse: parse,
    tokenize: tokenize,
    parseDirectiveLine: parseDirectiveLine,
    parseLyricLine: parseLyricLine
  };
})();
