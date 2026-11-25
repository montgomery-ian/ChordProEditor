/* ChordPro directive table: aliases, categories, descriptions.
   Used both for parsing (alias -> canonical) and the in-app directive reference / insert menu. */

var ChordProDirectives = (function () {
  "use strict";

  // Each entry: canonical name, list of short aliases, category, human description, insert snippet.
  var TABLE = [
    // Preamble / song boundary
    { name: "new_song", aliases: ["ns"], category: "layout", desc: "Starts a new song (song separator).", snippet: "{new_song}" },

    // Metadata
    { name: "title", aliases: ["t"], category: "meta", desc: "Song title.", snippet: "{title: }" },
    { name: "subtitle", aliases: ["st"], category: "meta", desc: "Subtitle (often the original artist).", snippet: "{subtitle: }" },
    { name: "sorttitle", aliases: [], category: "meta", desc: "Title used for sorting.", snippet: "{sorttitle: }" },
    { name: "artist", aliases: [], category: "meta", desc: "Performing artist.", snippet: "{artist: }" },
    { name: "sortartist", aliases: [], category: "meta", desc: "Artist used for sorting.", snippet: "{sortartist: }" },
    { name: "composer", aliases: [], category: "meta", desc: "Composer.", snippet: "{composer: }" },
    { name: "lyricist", aliases: [], category: "meta", desc: "Lyricist.", snippet: "{lyricist: }" },
    { name: "arranger", aliases: [], category: "meta", desc: "Arranger.", snippet: "{arranger: }" },
    { name: "copyright", aliases: [], category: "meta", desc: "Copyright notice.", snippet: "{copyright: }" },
    { name: "ccli", aliases: [], category: "meta", desc: "CCLI song number.", snippet: "{ccli: }" },
    { name: "album", aliases: [], category: "meta", desc: "Album name.", snippet: "{album: }" },
    { name: "year", aliases: [], category: "meta", desc: "Release year.", snippet: "{year: }" },
    { name: "key", aliases: [], category: "meta", desc: "Song key, e.g. {key: G}.", snippet: "{key: }" },
    { name: "time", aliases: [], category: "meta", desc: "Time signature, e.g. {time: 3/4}.", snippet: "{time: 4/4}" },
    { name: "tempo", aliases: [], category: "meta", desc: "Tempo in BPM.", snippet: "{tempo: }" },
    { name: "duration", aliases: [], category: "meta", desc: "Duration, e.g. {duration: 3:45}.", snippet: "{duration: }" },
    { name: "capo", aliases: [], category: "meta", desc: "Capo fret number.", snippet: "{capo: }" },
    { name: "tag", aliases: [], category: "meta", desc: "Arbitrary tag metadata.", snippet: "{tag: }" },
    { name: "meta", aliases: [], category: "meta", desc: "Generic key/value metadata: {meta: name value}.", snippet: "{meta: }" },
    { name: "x_instrument", aliases: [], category: "meta", desc: "App extension: sets the instrument for chord diagrams (guitar, ukulele or mandolin). A comment naming the instrument works too.", snippet: "{x_instrument: ukulele}" },

    // Formatting
    { name: "comment", aliases: ["c"], category: "format", desc: "Printed comment line.", snippet: "{comment: }" },
    { name: "comment_italic", aliases: ["ci"], category: "format", desc: "Italic comment line.", snippet: "{comment_italic: }" },
    { name: "comment_box", aliases: ["cb"], category: "format", desc: "Boxed comment line.", snippet: "{comment_box: }" },
    { name: "highlight", aliases: [], category: "format", desc: "Highlighted comment line.", snippet: "{highlight: }" },
    { name: "image", aliases: [], category: "format", desc: 'Embed an image: {image: src="url" scale="50%"}.', snippet: '{image: src="" }' },

    // Environments (start/end pairs) - generic start_of_X/end_of_X also handled by parser
    { name: "start_of_chorus", aliases: ["soc"], category: "env", desc: "Begin chorus section.", snippet: "{start_of_chorus}\n\n{end_of_chorus}" },
    { name: "end_of_chorus", aliases: ["eoc"], category: "env", desc: "End chorus section.", snippet: "{end_of_chorus}" },
    { name: "chorus", aliases: [], category: "env", desc: "Repeat the previous chorus.", snippet: "{chorus}" },
    { name: "start_of_verse", aliases: ["sov"], category: "env", desc: "Begin verse section.", snippet: "{start_of_verse}\n\n{end_of_verse}" },
    { name: "end_of_verse", aliases: ["eov"], category: "env", desc: "End verse section.", snippet: "{end_of_verse}" },
    { name: "start_of_bridge", aliases: ["sob"], category: "env", desc: "Begin bridge section.", snippet: "{start_of_bridge}\n\n{end_of_bridge}" },
    { name: "end_of_bridge", aliases: ["eob"], category: "env", desc: "End bridge section.", snippet: "{end_of_bridge}" },
    { name: "start_of_tab", aliases: ["sot"], category: "env", desc: "Begin tab block (fixed-width, unmodified).", snippet: "{start_of_tab}\n\n{end_of_tab}" },
    { name: "end_of_tab", aliases: ["eot"], category: "env", desc: "End tab block.", snippet: "{end_of_tab}" },
    { name: "start_of_grid", aliases: ["sog"], category: "env", desc: "Begin chord grid block.", snippet: "{start_of_grid}\n\n{end_of_grid}" },
    { name: "end_of_grid", aliases: ["eog"], category: "env", desc: "End chord grid block.", snippet: "{end_of_grid}" },

    // Delegated environments (rendered as labeled raw blocks - no music engraving in this editor)
    { name: "start_of_abc", aliases: [], category: "delegated", desc: "ABC notation block (shown as raw text; not engraved).", snippet: "{start_of_abc}\n\n{end_of_abc}" },
    { name: "end_of_abc", aliases: [], category: "delegated", desc: "End ABC block.", snippet: "{end_of_abc}" },
    { name: "start_of_ly", aliases: [], category: "delegated", desc: "LilyPond block (shown as raw text; not engraved).", snippet: "{start_of_ly}\n\n{end_of_ly}" },
    { name: "end_of_ly", aliases: [], category: "delegated", desc: "End LilyPond block.", snippet: "{end_of_ly}" },
    { name: "start_of_svg", aliases: [], category: "delegated", desc: "Raw SVG block.", snippet: "{start_of_svg}\n\n{end_of_svg}" },
    { name: "end_of_svg", aliases: [], category: "delegated", desc: "End SVG block.", snippet: "{end_of_svg}" },
    { name: "start_of_textblock", aliases: [], category: "delegated", desc: "Free text block, no chord parsing.", snippet: "{start_of_textblock}\n\n{end_of_textblock}" },
    { name: "end_of_textblock", aliases: [], category: "delegated", desc: "End text block.", snippet: "{end_of_textblock}" },

    // Chord diagrams
    { name: "define", aliases: [], category: "chord", desc: "Define a chord diagram, e.g. {define: Am base-fret 1 frets 0 2 2 1 0 0}.", snippet: "{define: base-fret 1 frets }" },
    { name: "chord", aliases: [], category: "chord", desc: "Insert a chord diagram for a chord.", snippet: "{chord: }" },

    // Transposition
    { name: "transpose", aliases: [], category: "chord", desc: "Transpose all chords by N semitones.", snippet: "{transpose: 0}" },

    // Layout
    { name: "new_page", aliases: ["np"], category: "layout", desc: "Force a new page (print layout).", snippet: "{new_page}" },
    { name: "new_physical_page", aliases: ["npp"], category: "layout", desc: "Force a new physical page (print layout).", snippet: "{new_physical_page}" },
    { name: "column_break", aliases: ["colb"], category: "layout", desc: "Start a new column (print layout).", snippet: "{column_break}" },
    { name: "pagetype", aliases: [], category: "layout", desc: "Page type for printing (legacy).", snippet: "{pagetype: }" },
    { name: "columns", aliases: ["col"], category: "layout", desc: "Number of columns (legacy).", snippet: "{columns: }" },
    { name: "grid", aliases: ["g"], category: "layout", desc: "Turn on chord grid display (legacy).", snippet: "{grid}" },
    { name: "no_grid", aliases: ["ng"], category: "layout", desc: "Turn off chord grid display (legacy).", snippet: "{no_grid}" },
    { name: "titles", aliases: [], category: "layout", desc: "Title alignment (legacy).", snippet: "{titles: }" },
    { name: "diagrams", aliases: [], category: "layout", desc: "Chord diagram display control (legacy).", snippet: "{diagrams: }" },

    // Fonts/sizes/colors (legacy, print-only - recognized, not rendered)
    { name: "chordfont", aliases: ["cf"], category: "legacy", desc: "Chord font (print only).", snippet: "{chordfont: }" },
    { name: "chordsize", aliases: ["cs"], category: "legacy", desc: "Chord size (print only).", snippet: "{chordsize: }" },
    { name: "chordcolour", aliases: [], category: "legacy", desc: "Chord color (print only).", snippet: "{chordcolour: }" },
    { name: "textfont", aliases: ["tf"], category: "legacy", desc: "Text font (print only).", snippet: "{textfont: }" },
    { name: "textsize", aliases: ["ts"], category: "legacy", desc: "Text size (print only).", snippet: "{textsize: }" },
    { name: "titlefont", aliases: [], category: "legacy", desc: "Title font (print only).", snippet: "{titlefont: }" }
  ];

  var byAlias = {};
  TABLE.forEach(function (d) {
    byAlias[d.name] = d.name;
    d.aliases.forEach(function (a) { byAlias[a] = d.name; });
  });

  function canonicalize(name) {
    var lower = name.toLowerCase();
    if (byAlias[lower]) return byAlias[lower];
    return lower; // unknown / custom (e.g. x_foo) - returned as-is
  }

  function info(canonicalName) {
    for (var i = 0; i < TABLE.length; i++) {
      if (TABLE[i].name === canonicalName) return TABLE[i];
    }
    return null;
  }

  return { TABLE: TABLE, canonicalize: canonicalize, info: info };
})();
