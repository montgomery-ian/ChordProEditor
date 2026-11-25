/* Chord chart styles, shared by the live chart and by Export HTML / Export PDF.
   Kept in JS (not only in style.css) because a page opened from disk (file://) isn't allowed to
   read its own stylesheet's rules, which left exports completely unstyled. Colors come from
   CSS variables: dark ones in style.css for the screen, the light "paper" set below for exports. */
var ChartStyle = (function () {
  "use strict";

  var CSS = "/* Rendered chart */\n.song-header { margin-bottom: 14px; border-bottom: 1px solid var(--border); padding-bottom: 10px; }\n.meta-title { font-family: var(--serif); font-size: 1.867em; margin: 0 0 2px; color: var(--title); }\n.meta-sub { font-size: 1em; color: var(--subtitle); margin-bottom: 6px; }\n.meta-line { font-size: .833em; color: var(--meta); }\n.meta-field-label { color: var(--meta-label); }\n.meta-sep { margin: 0 8px; color: var(--border); }\n.transpose-note { color: var(--accent); margin-top: 4px; }\n\n.capo-banner {\n  display: inline-flex; align-items: center; gap: 8px;\n  margin-top: 10px; padding: 5px 10px 5px 5px; border-radius: 7px;\n  background: var(--capo-bg);\n  color: var(--capo-text);\n}\n.capo-banner-badge {\n  font-size: .733em; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;\n  background: var(--capo-text); color: var(--capo-bg); border-radius: 4px; padding: 2px 7px;\n}\n.capo-banner-fret { font-size: .933em; font-weight: 700; }\n\n.chord-strip-wrap { margin: 12px 0 18px; }\n.instrument-badge { font-size: .667em; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin-bottom: 4px; }\n.chord-strip { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px; background: var(--strip-bg); border-radius: 6px; }\n.chord-diagram { background: transparent; width: 4.667em; height: auto; } /* 70px at the default 15px */\n.cd-name { font-size: 13px; font-weight: 700; fill: var(--diagram-name); font-family: var(--mono); }\n.cd-basefret { font-size: 7px; fill: var(--diagram-line); }\n.cd-line { stroke: var(--diagram-line); }\n.cd-dot { fill: var(--diagram-dot); }\n.cd-open { fill: none; stroke: var(--diagram-name); stroke-width: 1.3; }\n.cd-mute { font-size: 9px; fill: var(--danger); }\n.chord-chip-text { display: flex; align-items: center; justify-content: center; width: 5em; height: 6em; font-family: var(--mono); color: var(--chord); font-size: .933em; border: 1px dashed var(--border); border-radius: 4px; }\n\n.song-body { font-family: var(--mono); font-size: 1em; line-height: 1.5; }\n\n.chord-line { display: flex; flex-wrap: wrap; margin-top: .933em; gap: 0 2px; }\n.chord-cell { display: inline-flex; flex-direction: column; white-space: pre; }\n.chord-slot { color: var(--chord); font-weight: 700; font-size: .867em; min-height: 1.23em; line-height: 1.1; padding-right: .45em; }\n.lyric-slot { color: var(--lyric); }\n.chord-ext { font-size: .75em; margin-left: 1px; }\n.secondary-dom { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }\n.bass-slash { cursor: help; }\n.notation-note { color: var(--accent); margin-top: 4px; }\n.annotation { color: var(--accent-2); font-style: italic; font-size: .923em; }\n\n.lyric-line { margin-top: 2px; }\n.lyric-line.no-chords { color: var(--lyric); margin-top: 6px; }\n.lyric-line.empty-line { height: .667em; }\n\n.comment { margin: 10px 0; padding: 6px 10px; color: var(--comment); font-style: italic; border-left: 3px solid var(--comment); background: color-mix(in srgb, var(--comment) 8%, transparent); border-radius: 0 4px 4px 0; }\n.comment-italic { font-style: italic; }\n.comment-box { border: 1px solid var(--comment); border-left: 3px solid var(--comment); background: color-mix(in srgb, var(--comment) 8%, transparent); }\n.highlight { border-left-color: var(--accent-2); color: var(--accent-2); background: rgba(255,180,84,.08); }\n\n.env { margin: 16px 0; }\n.env-label { font-size: .733em; text-transform: uppercase; letter-spacing: .05em; color: var(--section); margin-bottom: 4px; }\n.env-chorus { padding: 8px 14px; border-left: 3px solid var(--accent-2); background: rgba(255,180,84,.06); border-radius: 0 6px 6px 0; }\n.env-chorus .env-label { color: var(--section); }\n.env-verse { padding-left: 10px; }\n.env-bridge { padding: 8px 14px; border-left: 3px solid var(--chord); background: color-mix(in srgb, var(--chord) 6%, transparent); border-radius: 0 6px 6px 0; }\n.env-generic { padding: 8px 14px; border-left: 3px solid var(--muted); }\n.env-repeat.empty { color: var(--muted); font-style: italic; }\n\n.raw-block, .raw-line { font-family: var(--mono); white-space: pre-wrap; color: var(--raw-fg); background: var(--raw-bg); padding: 10px; border-radius: 4px; margin: 6px 0; }\n\n.divider { margin: 18px 0; border-top: 1px dashed var(--border); position: relative; height: 1px; }\n.divider::after { content: attr(title); position: absolute; top: -9px; left: 10px; background: var(--sheet-bg); padding: 0 6px; font-size: .667em; color: var(--muted); }\n.song-separator { border: none; border-top: 2px solid var(--border); margin: 24px 0; }\n\n.song-image img { max-width: 100%; border-radius: 6px; margin: 10px 0; }\n";

  // Light theme + print layout used for exported charts.
  var PAPER_CSS = [
    ":root {",
    "  --bg: #ffffff; --text: #111111; --muted: #5a5a64; --border: #c9c9d2;",
    "  --accent: #1d5fb0; --accent-2: #a85400; --chord: #c2185b; --danger: #c62828;",
    "  --sheet-bg: #ffffff; --strip-bg: #f4f4f7; --raw-bg: #f4f4f7; --raw-fg: #1a2a4a;",
    "  --lyric: #111111; --section: #5a5a64; --comment: #1d5fb0;",
    "  --diagram-dot: var(--chord); --diagram-line: var(--muted); --diagram-name: var(--text);",
    "  --title: #111111; --subtitle: #5a5a64; --meta: #5a5a64; --meta-label: #a85400; --capo-bg: #a85400; --capo-text: #ffffff;",
    "  --mono: \"Cascadia Code\", Consolas, \"SF Mono\", Menlo, monospace;",
    "  --serif: Georgia, \"Times New Roman\", serif;",
    "}",
    "* { box-sizing: border-box; }",
    "html, body { margin: 0; background: var(--sheet-bg); color: var(--text); font-family: system-ui, -apple-system, Segoe UI, sans-serif;",
    "  -webkit-print-color-adjust: exact; print-color-adjust: exact; }",
    "body { padding: 24px; }",
    "#preview { max-width: 50em; margin: 0 auto; }",
    "@page { size: auto; margin: 0.5in; }",
    "@media print {",
    "  body { padding: 0; }",
    "  #preview { max-width: none; }",
    // keep a chord row with its lyric, diagrams whole, and a section label with what follows
    "  .chord-line, .lyric-line, .comment, .chord-chip, .song-header, .raw-line { break-inside: avoid; page-break-inside: avoid; }",
    "  .env-label { break-after: avoid; page-break-after: avoid; }",
    "  .page-break { break-after: page; page-break-after: always; border: none; }",
    "  .page-break::after, .column-break::after { display: none; }",
    "  .column-break { border: none; }",
    "}"
  ].join("\n");

  var el = document.createElement("style");
  el.id = "chartStyle";
  el.textContent = CSS;
  document.head.appendChild(el);

  return { CSS: CSS, PAPER_CSS: PAPER_CSS };
})();
