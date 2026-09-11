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
const MULTITEXT_FIELDS = new Set(["description", "tech description"]);

export function parseTable(text: string): ParseResult {
  // A leading UTF-8 BOM (U+FEFF - common in files saved by Windows editors like
  // Notepad) isn't stripped by VSCode's document text and isn't a real table
  // character. Left in place, it hides the FIRST line's leading "#"/"$"/"+"/"@" sigil
  // from every check below (`line.startsWith("#")` etc.), so a table's own real
  // `#Section` header goes unrecognized - every field in the file then falls through
  // to the "outside of any #Section block" loose-section path, even though the file is
  // a completely normal, correctly-headered table.
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
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

    if (line.startsWith("#")) {
      if (currentSection && isCloseToken(line, currentCloseToken)) {
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
          diagnostics.push({
            line: currentSection.startLine,
            startCol: 0,
            endCol: (lines[currentSection.startLine] || "").length,
            message: `Section "${currentSection.name}" was not closed with #End before the next section started`,
            severity: "error",
          });
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

    diagnostics.push({
      line: i,
      startCol: 0,
      endCol: rawLine.length,
      message: "Unrecognized line (expected a comment, #Section, $Field, +Subfield, or @Field)",
      severity: "warning",
    });
  }

  if (currentSection) {
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
 * by "End"; otherwise the close token is the generic "End".
 */
function closeTokenForSectionName(name: string): string {
  if (/start$/i.test(name)) {
    return name.replace(/start$/i, "End");
  }
  return "End";
}

/** Whether `line` (starting with '#') is the close token for a section - either the generic `#End` or that section's own table-specific close token. */
function isCloseToken(line: string, closeToken: string | null): boolean {
  const lower = line.toLowerCase();
  if (lower === "#end") {
    return true;
  }
  return closeToken !== null && lower === `#${closeToken}`.toLowerCase();
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
