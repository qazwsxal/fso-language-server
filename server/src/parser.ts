/**
 * Tolerant line-oriented parser for FSO .tbl/.tbm files.
 * Mirrors the conventions documented from FSO's own parselo.cpp-style grammar:
 * `;` comments, slash-star and bang-star block comments, `;;FSO x.y.z;;` version tags,
 * `#Section` ... `#End` (or a table-specific close token, e.g. `#Game Sounds Start`
 * .../`#Game Sounds End`), `$Field: value`, `+Subfield: value`, and `@Field: value` -
 * a third, less common sigil confirmed in weapons.tbl (the laser-visual cluster:
 * `@Laser Bitmap:`, `@Laser Glow:`, `@Laser Color:`, etc.) via a real mod file. Treated
 * like `+` for order-checking purposes (never order-checked - see schemaValidator.ts),
 * just a distinct sigil character.
 * Field-order validation against a specific table's schema is a separate pass,
 * deliberately not baked in here, so unknown/new fields don't break parsing.
 */

export type Severity = "error" | "warning";

export interface ParseDiagnostic {
  line: number;
  startCol: number;
  endCol: number;
  message: string;
  severity: Severity;
}

export interface FieldEntry {
  sigil: "$" | "+" | "@";
  key: string;
  value: string;
  line: number;
  raw: string;
}

export interface TableSection {
  name: string;
  startLine: number;
  endLine: number | null;
  entries: FieldEntry[];
}

export interface ParseResult {
  sections: TableSection[];
  diagnostics: ParseDiagnostic[];
}

/**
 * The synthetic `TableSection.name` used for fields that appear with no enclosing
 * `#Section` at all. FSO doesn't universally require one - rank.tbl is confirmed
 * (fso-table-fields-reference project memory, `scoring.cpp`'s `parse_rank_table()`) to
 * have NO hard-required section header: it only *optionally* skips past a legacy
 * `[RANK NAMES]` bracket header or a `#Ranks` header (via `check_for_string()`/
 * `skip_to_string()`, neither of which is `required_string()`), then reads `$Name:`
 * entries straight through. Crucially, the engine never identifies "this is the rank
 * table" from that header at all - it's called explicitly as `parse_rank_table` on the
 * fixed filename `rank.tbl` (and via `parse_modular_table("*-rnk.tbm", ...)`), same as
 * every other table's filename-based dispatch. This LSP already resolves files the same
 * way (see modResolution/resolver.ts), so by the time a caller knows to look for rank
 * entries it already knows the file is rank.tbl - it doesn't need an in-file marker
 * either. This section still gets a diagnostic per stray field (genuinely useful for
 * tables that DO require a header), but the fields themselves are no longer discarded.
 */
export const LOOSE_SECTION_NAME = "";

const MULTILINE_END_MARKERS = new Set(["$end_multi_text", "$end_custom_data"]);

/**
 * Fields confirmed (see fso-table-format/fso-table-fields-reference project memory) to
 * be read via `stuff_string(..., F_MULTITEXT, ...)`, i.e. free text terminated by a
 * literal `$end_multi_text` sentinel line rather than ending at end-of-line. Matched by
 * key alone (case-insensitive), regardless of sigil or table, since the mechanism is
 * uniform across every table that uses it.
 *
 * Deliberately a small, explicit allowlist rather than "any field with an empty value
 * scans forward for a sentinel" - an earlier version of this parser tried the generic
 * form and, confirmed against a real weapons.tbl, a bare marker field like `$Pspew:`
 * (which legitimately has no value and is followed by ordinary `+`-subfields, not free
 * text) scanned forward and swallowed every entry up to a much later, unrelated
 * `$end_multi_text` - silently eating real data. Scoping to known multitext fields only
 * avoids that failure mode.
 */
const MULTITEXT_FIELDS = new Set([
  "description",
  "tech description",
  "promotion text",
  // traitor.tbl (`code/stats/scoring.cpp`'s `parse_traitor_tbl()`) - confirmed real,
  // both `stuff_string(..., F_MULTITEXT)`. `$Text:` (also real there) isn't listed: a
  // real Between the Ashes traitor.tbl always puts its value inline on the same line,
  // which the sentinel-adjacency check just below this list already handles correctly
  // without needing a MULTITEXT_FIELDS entry.
  "multi text",
  "recommendation text",
]);

export interface ParseTableOptions {
  /**
   * A real, if uncommon, FSO section shape: instead of requiring an explicit `#End` (or
   * table-specific close token) before the next `#Section` header, a section from a
   * table with this option is considered closed the instant ANY new `#Section` header
   * appears - confirmed directly against source for every table that actually needs
   * this (game_settings.tbl's bare `#GAME SETTINGS`/`#CAMPAIGN SETTINGS`/etc. dividers;
   * messages.tbl's `#Personas`, closed by EITHER `#End` OR `#Messages` starting;
   * post_processing.tbl's `#Effects`/`#Ship Effects`; a real Between the Ashes SCPUI
   * `ui.tbl`/nodemap.tbl/`*-smap.tbm` family; `code/prop/prop.cpp`'s optional `#PROP
   * CATEGORIES` section; and `code/stats/scoring.cpp`'s `parse_traitor_tbl()`, whose two
   * sections just fall from one `if` block into the next with nothing between them at
   * all). Without this, every one of those tables' real files falsely reports its
   * next-to-last section (or, for traitor.tbl, both) as "not closed with #End before the
   * next section started" - a real structural quirk, not a mistake in the file. Whether
   * a given file's table actually works this way is filename-based, decided by the
   * caller (see server.ts's `isImplicitSectionCloseFile()`), since nothing in a
   * section's own name or content distinguishes it from a table that genuinely forgot
   * its `#End`.
   */
  autoCloseSectionsOnNextSection?: boolean;
  /**
   * Whether a section still open when the file ends is tolerated silently instead of
   * reported as "never closed with #End". Independent of
   * `autoCloseSectionsOnNextSection` above: most tables with THAT option still require a
   * real `#End` on their very last section (confirmed for game_settings.tbl/
   * messages.tbl/post_processing.tbl/ui.tbl/nodemap.tbl/`*-smap.tbm`/props.tbl) - this
   * is only for the rarer case (confirmed only for traitor.tbl) where NEITHER section
   * ever needs a close token, not even the last one, so reaching EOF with one still
   * "open" is completely normal.
   */
  tolerateUnclosedSectionAtEof?: boolean;
  /**
   * Confirmed real shape for credits.tbl/credits-footer.tbl (`credits_parse_table()`):
   * a fixed handful of optional `$Field:` lines at the very top of the file - not inside
   * any `#Section`, since real credits.tbl never uses one - followed by completely
   * unstructured, free-form scroll-credits text running to EOF (names, XSTR() markers
   * used as literal display text, blank lines, arbitrary punctuation - there's nothing
   * to extract). The set here lists the recognized leading field names (case-
   * insensitive, without the `$`/colon); the FIRST line that isn't blank and isn't one
   * of them switches parsing into "free text" mode for the rest of the file, silencing
   * every diagnostic rather than flagging each line of real display text as
   * unrecognized. An empty set (credits-footer.tbl has no leading fields of its own at
   * all) switches into free text mode immediately, on line 1.
   */
  freeTextAfterKnownLeadingFields?: Set<string>;
  /**
   * strings.tbl/tstrings.tbl (`code/localization/localize.cpp`'s
   * `parse_stringstbl_common()`): every entry inside a `#default`/`#<language>` section
   * is a bare `<index> "<string>" [offset] [offset]` line, with NO `$`/`+`/`@` sigil at
   * all. When true, a line starting with an optional `-` then digits, whitespace, and a
   * `"` is recognized (not extracted - there's nothing this project cross-references in
   * a localization string) instead of being flagged as "Unrecognized line".
   */
  allowBareIndexedStrings?: boolean;
  /**
   * hud_gauges.tbl (`code/hud/hudparse.cpp`'s `parse_hud_gauges_tbl()`): a `+Custom:`/
   * `+Scripted Gauge:`/etc. sub-block's own fields (`Origin:`, `Offset:`, `Name:`,
   * `Text:`, `Gauge Type:`, ...) use a bare `Key: value` shape with NO sigil at all -
   * confirmed against a real Between the Ashes bta-hdg.tbm. When true, a line matching
   * that shape (a leading letter, then word/space/quote/slash/dot/hyphen characters,
   * then a colon) is recognized instead of being flagged, the same "stop the noise,
   * don't try to extract or order-check it" treatment as `allowBareIndexedStrings`.
   */
  allowBareKeyValueLines?: boolean;
}

export function parseTable(text: string, options: ParseTableOptions = {}): ParseResult {
  const {
    autoCloseSectionsOnNextSection = false,
    tolerateUnclosedSectionAtEof = false,
    freeTextAfterKnownLeadingFields,
    allowBareIndexedStrings = false,
    allowBareKeyValueLines = false,
  } = options;
  /** Set once the free-text tail (see `freeTextAfterKnownLeadingFields`'s doc comment) begins - every remaining line is skipped with no further diagnostics or entries. */
  let inFreeTextTail = false;
  // A leading UTF-8 BOM (U+FEFF - common in files saved by Windows editors like
  // Notepad) isn't stripped by VSCode's document text and isn't a real table
  // character. Left in place, it hides the FIRST line's leading "#"/"$"/"+"/"@" sigil
  // from every check below (`line.startsWith("#")` etc.), so a table's own real
  // `#Section` header goes unrecognized - every field in the file then falls through
  // to the "outside of any #Section block" loose-section path, even though the file is
  // a completely normal, correctly-headered table.
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  // Kept alongside the block-comment-stripped `lines` below (same line count/numbering,
  // since stripBlockComments() preserves line breaks) purely so the embedded-Lua-chunk
  // handling further down can tell whether a `/*`/`!*` sequence it finds was actually
  // present in the modder's own source, rather than a sequence stripBlockComments()
  // already removed by the time `lines` is built - see LUA_CHUNK handling's doc comment.
  const originalLines = withoutBom.split(/\r\n|\r|\n/);
  const lines = stripBlockComments(withoutBom).split(/\r\n|\r|\n/);
  const sections: TableSection[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  let currentSection: TableSection | null = null;
  /** The literal close token (without '#') for the currently open section, e.g. "End" or "Game Sounds End". */
  let currentCloseToken: string | null = null;
  /** Lazily-created catch-all for fields with no enclosing `#Section` - see LOOSE_SECTION_NAME. */
  let looseSection: TableSection | null = null;
  /**
   * Whether the "outside of any #Section block" diagnostic has already fired for the
   * CURRENT contiguous run of sectionless fields - reset whenever a real `#Section`
   * opens. Confirmed against real Blue Planet mainhall.tbl/hud_gauges.tbl files: those
   * tables genuinely never use `#Section` at all (not just optionally, like rank.tbl),
   * so without this, every single field in the whole file - hundreds of them - got its
   * own near-identical warning. One diagnostic per contiguous run still flags something
   * genuinely useful (a stray field in an otherwise normal, section-using table) without
   * drowning a naturally sectionless table in noise.
   */
  let looseWarningEmitted = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = stripLineComment(stripVersionTag(rawLine)).trim();
    if (line.length === 0) {
      continue;
    }

    if (inFreeTextTail) {
      continue;
    }

    if (freeTextAfterKnownLeadingFields) {
      const colonIdx = line.indexOf(":");
      const key = (line.startsWith("$") ? (colonIdx === -1 ? line.slice(1) : line.slice(1, colonIdx)) : "")
        .trim()
        .toLowerCase();
      if (!line.startsWith("$") || !freeTextAfterKnownLeadingFields.has(key)) {
        inFreeTextTail = true;
        continue;
      }
    }

    if (line.startsWith("#")) {
      if (currentSection && isCloseToken(line, currentCloseToken, currentSection.name)) {
        currentSection.endLine = i;
        currentSection = null;
        currentCloseToken = null;
      } else if (line.toLowerCase() === "#end") {
        // No section is open - a stray #End with nothing to close.
        diagnostics.push({
          line: i,
          startCol: 0,
          endCol: rawLine.length,
          message: "#End found with no open #Section",
          severity: "warning",
        });
      } else {
        if (currentSection) {
          if (autoCloseSectionsOnNextSection) {
            currentSection.endLine = i - 1;
          } else {
            diagnostics.push({
              line: currentSection.startLine,
              startCol: 0,
              endCol: (lines[currentSection.startLine] || "").length,
              message: `Section "${currentSection.name}" was not closed with #End before the next section started`,
              severity: "error",
            });
          }
        }
        const name = line.slice(1).trim();
        currentSection = { name, startLine: i, endLine: null, entries: [] };
        currentCloseToken = closeTokenForSectionName(name);
        sections.push(currentSection);
        looseWarningEmitted = false;
      }
      continue;
    }

    if (line.startsWith("$") || line.startsWith("+") || line.startsWith("@")) {
      const sigil = line[0] as "$" | "+" | "@";
      const colonIdx = line.indexOf(":");
      let key: string;
      let value: string;
      if (colonIdx === -1) {
        key = line.slice(1).trim();
        value = "";
      } else {
        key = line.slice(1, colonIdx).trim();
        value = line.slice(colonIdx + 1).trim();
      }

      let entryValue = value;
      let entryValueWasSpecialCased = false;

      if (needsMultilineContinuation(entryValue)) {
        // Either a quoted string was left open on this line (e.g. `+Description: XSTR("`
        // - the quote appears after an "XSTR(" prefix, not at the start of the value, so
        // this can't just check entryValue.startsWith('"')), or a parenthesized list was
        // left open (e.g. `$Flags: ( "player allowed"` with each remaining list member
        // and its own trailing `;;` comment on its own line - confirmed against a real
        // Blue Planet bp-wep.tbm, where a `$Flags:` list AND a top-level `$Player Weapon
        // Precedence: (` list both span many lines this way). Consume subsequent lines
        // (each comment-stripped first, so an inline `;;` comment's own quotes/parens on
        // a continuation line can't skew the balance) until both the quote and paren
        // count balance out, or the file ends.
        let j = i + 1;
        while (j < lines.length && needsMultilineContinuation(entryValue)) {
          entryValue += "\n" + stripLineComment(stripVersionTag(lines[j]));
          j++;
        }
        i = j - 1;
        entryValueWasSpecialCased = true;
      } else if (entryValue.length === 0 && MULTITEXT_FIELDS.has(normalizeKey(key))) {
        // A known F_MULTITEXT field (e.g. `+Description:`) with nothing on its own
        // line: the real value is free text on the following lines, terminated by a
        // literal `$end_multi_text` sentinel (confirmed - see MULTITEXT_FIELDS doc
        // comment). Scoped to this known-field allowlist so it can't misfire on an
        // ordinary bare marker field like `$Trail:`/`$Pspew:`.
        let j = i + 1;
        const textLines: string[] = [];
        while (j < lines.length && !MULTILINE_END_MARKERS.has(lines[j].trim())) {
          textLines.push(lines[j]);
          j++;
        }
        entryValue = textLines.join("\n");
        i = j; // land on the sentinel line itself (or past EOF), consumed below
        entryValueWasSpecialCased = true;
      } else if (
        currentSection &&
        normalizeKey(currentSection.name) === "wing formations" &&
        sigil === "$" &&
        normalizeKey(key) === "name" &&
        i + 1 < lines.length &&
        stripLineComment(stripVersionTag(lines[i + 1])).trim().startsWith("(")
      ) {
        // Real grammar (`ship.cpp`'s `parse_wing_formation()`, called for a
        // `#Wing Formations` section): a formation's `$Name:` is immediately followed
        // by a completely bare, sigil-less `stuff_vec3d_list()` value spanning multiple
        // lines - no `+Subfield:` wrapper of any kind, confirmed against a real
        // wing_formations-shp.tbm. Consume it as part of this same field's value
        // (paren-balance tracked, same mechanism as the generic list-continuation case
        // above) so those lines aren't each flagged as "Unrecognized line".
        let j = i + 1;
        entryValue += "\n" + stripLineComment(stripVersionTag(lines[j]));
        j++;
        while (j < lines.length && parenBalance(entryValue) > 0) {
          entryValue += "\n" + stripLineComment(stripVersionTag(lines[j]));
          j++;
        }
        i = j - 1;
        entryValueWasSpecialCased = true;
      } else if (
        currentSection &&
        normalizeKey(currentSection.name) === "curves" &&
        sigil === "$" &&
        normalizeKey(key) === "keyframes"
      ) {
        // Real grammar (`code/math/curve.cpp`'s `Curve::ParseData()`, confirmed against
        // a real Star Fox Event Horizon curves.tbl): a curve's `$Keyframes:` is followed
        // by one or more completely bare, sigil-less `(x, y): InterpType[, params]`
        // lines - no `+Subfield:` wrapper of any kind - each read via
        // `stuff_parenthesized_vec2d()`/`required_string(":")`/`stuff_string()` in a
        // loop that stops at the next `$Name:` (the next curve) or an optional `#End`.
        // Every real keyframe line starts with "(", which neither of those stop
        // conditions do, so that's used as the continuation test here too.
        let j = i + 1;
        while (j < lines.length && stripLineComment(stripVersionTag(lines[j])).trim().startsWith("(")) {
          entryValue += (entryValue.length > 0 ? "\n" : "") + stripLineComment(stripVersionTag(lines[j]));
          j++;
        }
        i = j - 1;
        entryValueWasSpecialCased = true;
      } else if (
        isLuaChunkOpener(entryValue) ||
        (entryValue.length === 0 &&
          isLuaChunkOpener(peekFirstNonBlankLine(lines, i + 1).text) !== null)
      ) {
        // Real grammar (`code/scripting/scripting.cpp`'s `ParseChunkSub()`, used for
        // every field under scripting.tbl/*-sct.tbm's `#Global Hooks`/`#Conditional
        // Hooks` sections - confirmed against many real Between the Ashes/Warmachine/
        // Blackwater files): the value is an embedded Lua chunk, either literal Lua
        // between a single `[`...`]` pair or an external filename between a double
        // `[[`...`]]` pair. Found the same way FSO's own `alloc_block()` finds the
        // matching close - see findNaiveBracketClose()'s doc comment for why that
        // specific (not quote/comment-aware) algorithm is used rather than a "smarter"
        // one, and checkLuaChunkFootguns()'s doc comment for the real authoring
        // mistakes this can silently cause that this parser flags instead of masking.
        // The open bracket doesn't have to be on the very next line - a real Blackwater
        // axmsg-sct.tbm puts a blank line between `$On Game Init:` and its own `[`.
        const openOnOwnLine = entryValue.length === 0;
        const peeked = openOnOwnLine ? peekFirstNonBlankLine(lines, i + 1) : { line: i, text: entryValue };
        const openLine = peeked.line;
        const chunkStartText = peeked.text;
        const openToken = isLuaChunkOpener(chunkStartText)!;
        const closeToken = openToken === "[[" ? "]]" : "]";

        const scanLines: string[] = [chunkStartText.slice(openToken.length)];
        for (let j = openLine + 1; j < lines.length; j++) {
          scanLines.push(stripLineComment(stripVersionTag(lines[j])));
        }
        const scanText = scanLines.join("\n");
        const closeOffset = findNaiveBracketClose(scanText, openToken, closeToken);

        if (closeOffset === -1) {
          entryValue = openToken + scanText;
          i = lines.length - 1;
          // Before assuming the modder simply forgot the closing bracket, check whether
          // a stray comment-opener earlier in the chunk swallowed it instead (see
          // checkLuaChunkFootguns()'s doc comment, footgun 2) - stripBlockComments()
          // already ran on the whole file before this point, so if that's what
          // happened, the real close token is gone from `lines`/`scanText` entirely and
          // this scan could never have found it regardless of the Lua code's own
          // correctness. `originalLines` still has it, though.
          const culpritLine = findBlockCommentOpenerLine(originalLines, openLine, lines.length - 1);
          diagnostics.push(
            culpritLine === null
              ? {
                  line: openLine,
                  startCol: 0,
                  endCol: (lines[openLine] || "").length,
                  message: `This embedded Lua chunk's "${openToken}" is never closed with a matching "${closeToken}" - FSO reports a parse error here ("Unclosed pair of \\"${openToken}\\" and \\"${closeToken}\\"") and everything after it in this file fails to load.`,
                  severity: "error",
                }
              : {
                  line: culpritLine,
                  startCol: 0,
                  endCol: (originalLines[culpritLine] || "").length,
                  message:
                    'This line contains a "/*" or "!*" sequence, which FSO treats as the start of a comment - since no matching closer follows, it silently consumed the rest of this Lua chunk (including its real closing bracket) and everything after it in this file, which is why the chunk above looks unclosed. If this wasn\'t meant as a comment, remove or escape it.',
                  severity: "error",
                },
          );
        } else {
          const consumed = scanText.slice(0, closeOffset);
          entryValue = openToken + consumed;
          const lastConsumedLine = openLine + countChar(consumed, "\n");
          i = lastConsumedLine;
          checkLuaChunkFootguns(openToken, openLine, consumed, scanText, closeOffset, originalLines, diagnostics);
        }
        entryValueWasSpecialCased = true;
      }

      if (!entryValueWasSpecialCased) {
        // A single-line value that's ENTIRELY one quoted token (e.g. `$Species:
        // "Terran"`) - confirmed against a real Blue Planet bp-main-hall.tbm - should
        // resolve identically to the unquoted form (`$Species: Terran`): FSO's own
        // stuff_string()/F_NAME reader accepts a value either bare or quoted and strips
        // the quotes either way, but this parser's plain line-slicing had no equivalent
        // step, so a quoted scalar silently carried its literal quote characters into
        // every downstream comparison (species_defs.tbl lookups, texture/sound index
        // lookups, ...) and never matched. Scoped to the plain single-line case only -
        // skipped for the multiline-continuation/multitext branches above, whose
        // richer values are handled on their own terms and shouldn't have an outer
        // quote pair stripped as a side effect.
        const trimmed = entryValue.trim();
        if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
          entryValue = trimmed.slice(1, -1);
        }
      }

      // A closed multi-line quote is typically immediately followed by its own
      // `$end_multi_text`/`$end_custom_data` sentinel line - consume it too so it
      // doesn't show up as its own spurious field entry. (When the multitext scan above
      // ran instead, `i` already sits exactly on the sentinel line itself, so this
      // check - which looks one line further - correctly finds nothing to do; the
      // sentinel is still skipped, via the for-loop's own `i++`, once this entry is
      // pushed below.)
      if (i + 1 < lines.length && MULTILINE_END_MARKERS.has(lines[i + 1].trim())) {
        i += 1;
      }

      if (!currentSection) {
        // Still worth flagging - most tables DO require a `#Section` wrapper, and this
        // is genuinely a mistake for those. But the field itself is real data (rank.tbl
        // legitimately has none - see LOOSE_SECTION_NAME), so it's captured rather than
        // discarded, into a synthetic catch-all section a table-specific extractor can
        // choose to read from when it already knows (by filename) that a missing header
        // is expected. Only the FIRST field in a contiguous sectionless run gets the
        // diagnostic (see looseWarningEmitted doc comment) - a table that never uses
        // `#Section` at all would otherwise get one near-identical warning per field.
        if (!looseWarningEmitted) {
          diagnostics.push({
            line: i,
            startCol: 0,
            endCol: rawLine.length,
            message: `"${sigil}${key}" appears outside of any #Section block`,
            severity: "warning",
          });
          looseWarningEmitted = true;
        }
        if (!looseSection) {
          looseSection = { name: LOOSE_SECTION_NAME, startLine: i, endLine: null, entries: [] };
          sections.push(looseSection);
        }
        looseSection.entries.push({ sigil, key, value: entryValue, line: i, raw: rawLine });
        continue;
      }

      currentSection.entries.push({ sigil, key, value: entryValue, line: i, raw: rawLine });
      continue;
    }

    if (/^\[[^[\]]*\]$/.test(line)) {
      // A whole-line `[Bracket Header]` - the legacy pre-`#Section` header style,
      // confirmed only for rank.tbl's optional `[RANK NAMES]` (see LOOSE_SECTION_NAME).
      // Not flagged as unrecognized: it's a real, if archaic, piece of FSO table syntax,
      // not malformed input - just decorative, so it's silently skipped rather than
      // opening a section (matching the real parser's check_for_string()/skip_to_string()
      // treatment: present or absent, parsing continues the same way either side of it).
      continue;
    }

    if (allowBareIndexedStrings && /^-?\d+\s*,?\s*"/.test(line)) {
      // strings.tbl/tstrings.tbl (`code/localization/localize.cpp`'s
      // `parse_stringstbl_common()`): every entry is a bare `<index>, "<string>"
      // [offset] [offset]` line with NO `$`/`+`/`@` sigil at all - nothing worth
      // extracting for this project's purposes (no cross-referencing need), so this
      // just recognizes the shape well enough to stop flagging every line as
      // unrecognized rather than trying to capture it as a field. The comma is
      // optional-but-common: FSO's own stuff_int() explicitly consumes a trailing
      // comma after the digits (parselo.cpp), so real tables use both styles.
      let value = line;
      let j = i + 1;
      while (j < lines.length && countChar(value, '"') % 2 === 1) {
        // A real string's content can itself contain a literal newline - `get_string()`
        // reads raw bytes until the closing `"`, with no per-line grammar of its own -
        // confirmed against a real Between the Ashes tstrings.tbl entry whose closing
        // quote lands several lines below its opening one. Deliberately NOT run through
        // stripLineComment()/stripVersionTag() here: FSO's real strip_comments()
        // (parselo.cpp) tracks its `in_quote` flag ACROSS the whole file, so a `;`
        // inside a still-open string is never treated as a comment start - but this
        // parser's per-line stripLineComment() has no such cross-line memory, so
        // applying it while a string is open would wrongly truncate a real translated
        // sentence that happens to contain a semicolon (confirmed against a real
        // SCPUI-0.9.0 tstrings.tbl entry: "...Nebelgebietes; es kann..." mid-string).
        value += "\n" + lines[j];
        j++;
      }
      i = j - 1;
      continue;
    }

    if (allowBareKeyValueLines && /^[A-Za-z0-9][\w '"/.-]*:/.test(line)) {
      // hud_gauges.tbl (`code/hud/hudparse.cpp`'s `parse_hud_gauges_tbl()`): a
      // `+Custom:`/`+Scripted Gauge:`/etc. sub-block's own fields (`Origin:`,
      // `Offset:`, `Name:`, `Text:`, `Gauge Type:`, ...) use a bare `Key: value` shape
      // with NO sigil - confirmed against a real Between the Ashes bta-hdg.tbm. As with
      // the bare indexed strings above, this just recognizes the shape (a leading
      // letter or digit, then word/space/quote/slash/dot/hyphen characters, then a
      // colon) well enough to stop flagging it, without trying to extract or
      // order-check it - the real per-gauge-type field lists run into the dozens and
      // aren't schema-checked by this project regardless. The leading-digit allowance
      // is needed for real fields like `3 Digit Hull Offsets:` (confirmed against a
      // real Blue Planet Complete mv_root-hdg.tbm).
      continue;
    }

    diagnostics.push({
      line: i,
      startCol: 0,
      endCol: rawLine.length,
      message: "Unrecognized line (expected a comment, #Section, $Field, +Subfield, or @Field)",
      severity: "warning",
    });
  }

  if (currentSection && !tolerateUnclosedSectionAtEof) {
    diagnostics.push({
      line: currentSection.startLine,
      startCol: 0,
      endCol: (lines[currentSection.startLine] || "").length,
      message: `Section "${currentSection.name}" was never closed with #End`,
      severity: "error",
    });
  }

  return { sections, diagnostics };
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

/**
 * Most tables close a section with a plain `#End`/`#end`/`#END`, but some (sounds.tbl's
 * `#Game Sounds Start`/`#Game Sounds End`, `#Interface Sounds Start`/`#Interface Sounds
 * End`, etc. - confirmed in fso-table-format project memory) use a distinctly-named
 * close token derived from the open token. When a section's opening name ends in
 * "Start" (case-insensitive), its close token is that same name with "Start" replaced
 * by "End". lightning.tbl uses the same shape with different words - confirmed against
 * `code/nebula/neblightning.cpp`: `#Bolts begin`/`#Bolts end`, `#Storms begin`/`#Storms
 * end` (real Between the Ashes lightning.tbl) - so "Begin" (case-insensitive) is
 * recognized the same way. Otherwise the close token is the generic "End".
 */
function closeTokenForSectionName(name: string): string {
  if (/start$/i.test(name)) {
    return name.replace(/start$/i, "End");
  }
  if (/begin$/i.test(name)) {
    return name.replace(/begin$/i, "end");
  }
  return "End";
}

/**
 * Whether `line` (starting with '#') is the close token for a section - the generic
 * `#End`, that section's own suffix-style close token (`closeTokenForSectionName()`'s
 * "X Start" -> "X End" pattern, e.g. `#Game Sounds Start`/`#Game Sounds End`), or a
 * PREFIX-style `#End <Name>` close token (e.g. lighting_profiles.tbl's real grammar:
 * `#Profiles` opens, `#END PROFILES` closes - confirmed against a real Blue Planet
 * bp-ltp.tbm that ends this way, and against lighting_profiles.cpp's
 * `optional_string_one_of(..., "#PROFILES", ..., "#END PROFILES")`; same for
 * `#DEFAULT PROFILE`/`#END DEFAULT PROFILE`). Both conventions exist in real FSO tables,
 * so both are accepted for every section rather than picking one per table.
 */
function isCloseToken(line: string, closeToken: string | null, sectionName: string): boolean {
  const lower = line.toLowerCase();
  if (lower === "#end") {
    return true;
  }
  if (closeToken !== null && lower === `#${closeToken}`.toLowerCase()) {
    return true;
  }
  return lower === `#end ${sectionName}`.toLowerCase();
}

/**
 * Strips a `;` line comment, ignoring `;` characters that appear inside a quoted
 * string (confirmed: `in_quote` is tracked per-line in FSO's own `strip_comments()`, so
 * an unterminated quote never carries this state across lines).
 */
function stripLineComment(line: string): string {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ";" && !inQuotes) {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * Strips a `;;FSO x.y.z;;`-style version-compatibility tag (confirmed via
 * `matches_version_specific_tag()` in parselo.cpp - see fso-table-format project
 * memory). In the real engine this can make the rest of the line vanish entirely if the
 * running build doesn't match; this LSP has no concept of a "target build version" to
 * gate against, so - consistent with this parser's tolerant, best-effort philosophy -
 * it strips just the tag itself and keeps the remainder of the line as live content
 * (i.e. behaves as if every version tag always matches), rather than either crashing on
 * the unfamiliar syntax or silently discarding real field data. Only recognized at the
 * start of the (trimmed) line, matching real-world usage as a line prefix.
 */
function stripVersionTag(line: string): string {
  return line.replace(/^(\s*);;\s*FSO[^;]*;;/i, "$1");
}

/**
 * Removes slash-star and bang-star block comments (confirmed distinct, mutually
 * non-nesting styles - see fso-table-format project memory) from the whole document in
 * one pass, preserving line breaks (and therefore line numbers) so downstream line-based
 * diagnostics stay accurate. Quote-awareness resets at each newline (matching the
 * per-line `in_quote` tracking `strip_comments()` uses for `;` above) since an
 * unterminated quote isn't expected to span lines here either.
 */
function stripBlockComments(text: string): string {
  let result = "";
  let mode: null | "slash" | "bang" = null;
  let inQuotes = false;

  for (let i = 0; i < text.length; ) {
    const ch = text[i];

    if (ch === "\n") {
      if (mode === null) {
        inQuotes = false;
      }
      result += "\n";
      i++;
      continue;
    }

    if (mode === null) {
      if (ch === '"') {
        inQuotes = !inQuotes;
        result += ch;
        i++;
        continue;
      }
      if (!inQuotes && ch === "/" && text[i + 1] === "*") {
        mode = "slash";
        i += 2;
        continue;
      }
      if (!inQuotes && ch === "!" && text[i + 1] === "*") {
        mode = "bang";
        i += 2;
        continue;
      }
      result += ch;
      i++;
      continue;
    }

    // Inside a block comment: look for its specific closer.
    const closer = mode === "slash" ? "*/" : "*!";
    if (ch === closer[0] && text[i + 1] === closer[1]) {
      mode = null;
      i += 2;
      continue;
    }
    i++;
  }

  return result;
}

function countChar(s: string, c: string): number {
  let n = 0;
  for (const ch of s) {
    if (ch === c) {
      n++;
    }
  }
  return n;
}

/** Count of unmatched `(` in `s`, ignoring parens inside `"..."` quotes. Negative if there's an unmatched `)` (not expected in well-formed input, but harmless - just means "not waiting on more"). */
function parenBalance(s: string): number {
  let depth = 0;
  let inQuotes = false;
  for (const ch of s) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && ch === "(") {
      depth++;
    } else if (!inQuotes && ch === ")") {
      depth--;
    }
  }
  return depth;
}

/** Whether a field value looks incomplete and needs more lines appended - an open quote (odd count) or an unclosed parenthesized list. */
function needsMultilineContinuation(value: string): boolean {
  return countChar(value, '"') % 2 === 1 || parenBalance(value) > 0;
}

/** Whether `value` opens an embedded Lua chunk (see the parseTable() branch that uses this) - a literal `[` for inline Lua, or `[[` for an external filename. Checked in this order since `[[` also matches a naive `startsWith("[")`. */
function isLuaChunkOpener(value: string): "[[" | "[" | null {
  if (value.startsWith("[[")) return "[[";
  if (value.startsWith("[")) return "[";
  return null;
}

/**
 * Scans forward from `fromIndex` for the first line whose comment/version-tag-stripped,
 * trimmed content is non-empty, skipping blank lines in between - confirmed necessary
 * against a real Blackwater Operations axmsg-sct.tbm, which puts a genuinely blank line
 * between `$On Game Init:` (nothing on its own line) and its own opening `[` on the
 * line after that; checking only the SINGLE next line (as an earlier version of this
 * function did) missed the chunk entirely, leaving its whole body to be parsed as
 * ordinary table lines. Returns `{ line: lines.length, text: "" }` if the file ends
 * first without finding one.
 */
function peekFirstNonBlankLine(lines: string[], fromIndex: number): { line: number; text: string } {
  for (let k = fromIndex; k < lines.length; k++) {
    const text = stripLineComment(stripVersionTag(lines[k])).trim();
    if (text.length > 0) {
      return { line: k, text };
    }
  }
  return { line: lines.length, text: "" };
}

/**
 * Mirrors `code/parse/parselo.cpp`'s `alloc_block()` EXACTLY: a raw, syntax-blind
 * character-by-character scan that treats `openTok`/`closeTok` as plain substrings and
 * checks for a match at EVERY position (not skipping ahead by the matched length, so a
 * literal "[[" checked against a single-character `openTok` of "[" counts as two
 * separate opens) - confirmed directly against the engine's source: it has no quote or
 * comment awareness of any kind, since the same generic function is also used for
 * other, non-Lua bracketed blocks. `text` is the content STARTING RIGHT AFTER the
 * initial open token (which the real engine has already consumed via
 * `required_string(startstr)` before this scan begins, hence starting `level` at 1
 * rather than 0). Returns the index in `text` one past the matching close token, or -1
 * if `text` runs out without `level` returning to 0 - matching the engine's own
 * "Unclosed pair of ..." parse error, which aborts parsing the rest of the file.
 */
function findNaiveBracketClose(text: string, openTok: string, closeTok: string): number {
  let level = 1;
  for (let pos = 0; pos < text.length; pos++) {
    if (text.startsWith(openTok, pos)) {
      level++;
    } else if (text.startsWith(closeTok, pos)) {
      level--;
    }
    if (level <= 0) {
      return pos + closeTok.length;
    }
  }
  return -1;
}

/**
 * A Lua-literate approximation of the same scan, used ONLY as a cross-check against
 * findNaiveBracketClose() for the single-bracket (inline Lua, not external-filename)
 * case - see checkLuaChunkFootguns(). Unlike the real engine, this skips the contents
 * of short string literals ('...'/"..." with backslash escapes) and short `--` line
 * comments before counting '['/']', since those are the two situations where a stray
 * bracket character inside otherwise-normal Lua can desync from what FSO's own unaware
 * scan finds. A Lua LONG bracket string/comment (`[[...]]`, `[=[...]=]`) is
 * deliberately NOT special-cased: it always contributes a perfectly matched, net-zero
 * pair of literal '['/']' characters no matter how many '=' signs it uses, so counting
 * its brackets normally (rather than detecting and skipping the whole span) still gives
 * the right answer with far less code - it only needs to be told apart from a SHORT
 * `--` comment so that comment-skipping doesn't eat the long form's own opening `[[`
 * and leave its closing `]]` to be miscounted as two bare, unmatched closes.
 */
function findLuaAwareBracketClose(text: string): number {
  let level = 1;
  let pos = 0;
  while (pos < text.length) {
    const ch = text[pos];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      pos++;
      while (pos < text.length && text[pos] !== quote) {
        pos += text[pos] === "\\" ? 2 : 1;
      }
      pos++;
      continue;
    }
    if (text.startsWith("--", pos) && !/^--\[=*\[/.test(text.slice(pos))) {
      const nl = text.indexOf("\n", pos);
      pos = nl === -1 ? text.length : nl + 1;
      continue;
    }
    if (ch === "[") {
      level++;
    } else if (ch === "]") {
      level--;
    }
    if (level <= 0) {
      return pos + 1;
    }
    pos++;
  }
  return -1;
}

/**
 * Scans `originalLines[fromLine..toLine]` (the pre-`stripBlockComments()` text - see
 * `parseTable()`'s own `originalLines`) for a line containing a slash-then-asterisk or
 * bang-then-asterisk sequence, i.e. a real FSO block-comment opener. Used only to give
 * a more useful diagnostic when a Lua chunk appears unclosed: if one of these opened
 * with nothing to close it, `stripBlockComments()` already consumed everything after it
 * - including the chunk's real closing bracket - before this parser ever got to look
 * for one, so "you forgot the closing bracket" would be the wrong thing to tell the
 * modder. Returns the line number of the first match, or null if none is found.
 */
function findBlockCommentOpenerLine(originalLines: string[], fromLine: number, toLine: number): number | null {
  for (let k = fromLine; k <= toLine && k < originalLines.length; k++) {
    if (originalLines[k].includes("/*") || originalLines[k].includes("!*")) {
      return k;
    }
  }
  return null;
}

/**
 * Finds the column of the first ';' outside a double-quoted string in `line` (mirrors
 * `stripLineComment()`'s own quote-toggle logic, but reports the position instead of
 * truncating there), or -1 if none - and also -1 if that ';' comes AFTER a Lua `--`
 * line-comment marker earlier on the line (outside quotes) that isn't itself the start
 * of a Lua long comment. In that case FSO's real truncation only deletes text that was
 * already inert Lua-comment content (confirmed against two real, shipped Between the
 * Ashes scripts - old commented-out code ending in a stray `;`, e.g. `break;` at the
 * end of a comment) - a real instance of the underlying footgun, but not one worth
 * surfacing, since nothing FSO discards there would have executed anyway. A `;` that
 * appears BEFORE the `--` (i.e. in real, live code on the same line as a trailing
 * comment) is still reported normally.
 */
function findUnquotedSemicolon(line: string): number {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && line.startsWith("--", i) && !/^--\[=*\[/.test(line.slice(i))) {
      return -1;
    } else if (ch === ";" && !inQuotes) {
      return i;
    }
  }
  return -1;
}

/**
 * FSO's table-comment stripping (`code/parse/parselo.cpp`'s `strip_comments()`, applied
 * to the WHOLE file as plain text before any table-specific parsing - including the
 * Lua-chunk scan above - ever sees it) has no idea some of that text is about to become
 * a Lua script. Confirmed directly against that function, this creates real, silent-
 * failure footguns for anyone writing Lua inside a table field:
 *
 * 1. A bare `;` OUTSIDE a double-quoted string is treated as "the rest of this line is
 *    an FSO comment" and silently discarded - including inside a Lua chunk. Lua's own
 *    optional `;` statement separator, or a `;` inside a Lua SINGLE-quoted string
 *    (`strip_comments()` only tracks double quotes, since that's the only quote style
 *    FSO's own table syntax has), triggers this: `local x = 5; local y = 10` silently
 *    loses `local y = 10` entirely, and `local s = 'a;b'` silently loses `b'` (and the
 *    closing quote) - both without any error, and the truncated result may still
 *    happen to look like valid Lua.
 * 2. A slash immediately followed by an asterisk (or a bang immediately followed by an
 *    asterisk) are FSO's own (non-Lua) block-comment openers, recognized ANYWHERE in
 *    the file, including inside embedded Lua source - which never uses either sequence
 *    itself, but can easily contain one by coincidence: a Lua comment mentioning
 *    C-style comments, a string literal containing that two-character sequence, or
 *    simply a division immediately followed by a dereference-style identifier (no
 *    space between them). If the matching closer isn't nearby, everything up to
 *    wherever one next appears - possibly much later in the file, in a completely
 *    unrelated table - silently vanishes too.
 *
 * Neither of these is a mistake this extension is making - both mirror confirmed real
 * engine behavior exactly, via findNaiveBracketClose()/the shared stripLineComment()/
 * stripBlockComments() this parser already applies to every line - so they can't be
 * "fixed" here without behaving differently from the game itself on the modder's real
 * file. What this extension CAN do that the game doesn't is warn about them, since both
 * are easy to trigger completely by accident while writing Lua (not FSO table syntax)
 * and silently produce no error message at all from the game.
 *
 * A third, narrower check (single-bracket chunks only): compare where FSO's own unaware
 * scan closed the chunk against where a Lua-literate scan (findLuaAwareBracketClose())
 * would close it - a mismatch means a stray '['/']' inside a Lua string or short
 * comment is confusing FSO's own bracket counting into ending the chunk somewhere the
 * Lua source itself wouldn't.
 */
function checkLuaChunkFootguns(
  openToken: "[" | "[[",
  openLine: number,
  /** The chunk's own content, from right after the open token through right after the matching close token - i.e. `scanText.slice(0, naiveCloseOffset)`. Its own line 0 lines up with `openLine` in the file (both already exclude the field's own "$Field: [" prefix and the open token itself). */
  consumed: string,
  /** The full remaining document text the close token was searched in (NOT truncated to `consumed`) - needed so the Lua-aware cross-check below can look PAST a premature naive close to find where Lua rules would really end the chunk. */
  scanText: string,
  naiveCloseOffset: number,
  originalLines: string[],
  diagnostics: ParseDiagnostic[],
): void {
  const consumedLines = consumed.split("\n");
  for (let idx = 0; idx < consumedLines.length; idx++) {
    const fileLine = openLine + idx;
    const original = originalLines[fileLine] ?? "";

    // Checked against the ORIGINAL line (minus a leading version tag - see below), not
    // `consumed`/`consumedLines`: by the time a line reaches `consumed`, it's already
    // been through the same `stripLineComment()` this parser applies to every other
    // line, which means a genuine footgun instance has ALREADY had everything from the
    // ';' onward removed and would never be found by looking at the (already-truncated)
    // stripped text. `stripVersionTag()` is applied first because a real `;;FSO
    // x.y.z;;` version tag (confirmed against a real Warmachine mv_dbrs-sct.tbm, which
    // prefixes several real, working lines with one to make them version-conditional)
    // is itself built from two double-semicolons - genuinely not a comment-cutting
    // footgun, since FSO's own `strip_comments()` specifically recognizes and skips
    // past a matching tag before ever looking for a plain `;` comment.
    const versionStripped = stripVersionTag(original);
    const semicolonCol = findUnquotedSemicolon(versionStripped);
    if (
      semicolonCol !== -1 &&
      versionStripped.slice(0, semicolonCol).trim().length > 0 &&
      versionStripped.slice(semicolonCol + 1).trim().length > 0
    ) {
      // Nothing but whitespace precedes the ';' on this line (after stripping any
      // leading version tag) means the WHOLE line was already just a plain comment -
      // e.g. a modder writing a bare `;; explanatory note` line, confirmed against a
      // real The Sixth Seal proBox-sct.tbm. Since there's no real Lua code before the
      // ';' to lose, warning here would just be noise on an intentional comment, not a
      // genuine footgun - this only fires when a ';' cuts off something AFTER real
      // content earlier on the same line.
      //
      // Symmetrically, nothing but whitespace AFTER the ';' (a trailing Lua statement
      // terminator with nothing following it on the line, e.g. `lastTime = currentTime;`
      // - confirmed against a real Star Fox Event Horizon mainmenumovie-sct.tbm) means
      // there's genuinely nothing left for FSO's comment-stripping to discard either -
      // also not a real footgun, just a very common Lua style choice.
      // stripVersionTag() only ever removes a leading prefix, so adding back how much
      // shorter the result is recovers the correct column in the untouched `original`.
      const versionTagLength = original.length - versionStripped.length;
      diagnostics.push({
        line: fileLine,
        startCol: semicolonCol + versionTagLength,
        endCol: original.length,
        message:
          'FSO treats everything after this ";" as a comment, even inside an embedded Lua script - it will be silently discarded when this table loads. If this is Lua\'s ";" statement separator or inside a single-quoted string, rewrite this line to avoid a bare ";".',
        severity: "warning",
      });
    }

    if (original.includes("/*") || original.includes("!*")) {
      // A `;;FSO x.y.z;;` version tag immediately followed by one of these is a real,
      // intentional pattern (confirmed against a real Warmachine mv_dbrs-sct.tbm): since
      // a version tag for an incompatible build discards the rest of ITS OWN line but
      // otherwise has no effect, pairing one with a block-comment opener/closer lets a
      // modder wrap a whole span of Lua in a comment that only exists on builds where
      // the tag doesn't match - i.e. "only compile this code on version X and below" (or
      // above). Softened wording for that case rather than implying a likely mistake.
      const isVersionGated = /;;\s*FSO\b[^;]*;;\s*(\/\*|!\*)/.test(original);
      diagnostics.push({
        line: fileLine,
        startCol: 0,
        endCol: original.length,
        message: isVersionGated
          ? 'This looks like a version-tag-gated comment block (a ";;FSO x.y.z;;" tag paired with a "/*" or "!*") - a real, intentional way to wrap Lua in a block comment that only applies on certain engine versions. Just confirm the commented-out span - up to the next matching "*/"/"*!" - covers exactly the code you intend, since this parser (and FSO itself) finds that closer with plain text matching, not by understanding Lua.'
          : 'FSO treats "/*" and "!*" as the start of a comment anywhere in the file, including inside embedded Lua (which never uses either sequence itself). If this wasn\'t meant as a comment, everything up to wherever a matching "*/"/"*!" next appears - possibly much later in this file - may have been silently discarded when this table loaded.',
        severity: "warning",
      });
    }
  }

  if (openToken === "[") {
    const luaAwareClose = findLuaAwareBracketClose(scanText);
    if (luaAwareClose !== -1 && luaAwareClose !== naiveCloseOffset) {
      diagnostics.push({
        line: openLine,
        startCol: 0,
        endCol: consumedLines[0].length,
        message:
          "This Lua chunk contains a '[' or ']' inside a string or comment that makes FSO's own bracket counting (which doesn't understand Lua syntax) close it somewhere different from where the Lua code itself would end - verify this script isn't being truncated or extended unexpectedly when this table loads.",
        severity: "warning",
      });
    }
  }
}
