import { ParseDiagnostic } from "./parser";

/**
 * Dedicated parser for menu.tbl - a completely different, bespoke mini-grammar from
 * every other table this project understands, confirmed against
 * `code/menuui/snazzyui.cpp`'s `read_menu_tbl()`: no `$Field:`/`+Subfield:`/`#Section`
 * sigils at all, just raw `cfgets()`/`strtok()` line parsing. Genuinely still real, live
 * FSO grammar (not legacy cruft) - `code/menuui/trainingmenu.cpp` calls
 * `read_menu_tbl("TRAINING MENU", ...)` for the Training/Simulator room screen, so a
 * `[TRAINING MENU]` section's syntax actually matters in-game. Other bracket sections
 * (`[MAIN HALL]`, `[BARRACKS MENU]`, etc., seen in real Solaris/Star Fox Event Horizon
 * menu.tbl files) are syntactically identical but have no current caller - dead content,
 * not a different grammar - so every section is validated the same way regardless of
 * name, on the theory that a modder editing any of them still wants correct syntax.
 *
 * Real grammar, read directly from `read_menu_tbl()`:
 * - The file is a flat sequence of `[Menu Name]` bracket-header sections - NOT `#Section`.
 * - `;` truncates the rest of a line as a comment - via a plain `strchr()`, NOT
 *   quote-aware like the main table grammar's `stripLineComment()`, so a literal `;`
 *   inside a region's quoted text would genuinely truncate mid-string in real FSO too.
 * - The first non-blank line after a section header is `<background> <mask>` - two
 *   bare, whitespace/comma-separated filenames, no quotes.
 * - Every following non-blank line is a clickable region: `"<text>" <mask_num>
 *   <hotkey_char>` - quoted text, then two more whitespace/comma-separated tokens. Any
 *   further tokens on the line (real files document `anim_start anim_selected
 *   anim_static anim_leave` columns here) are read by nothing - `read_menu_tbl()` never
 *   looks past the hotkey token, so they're inert, not a mistake.
 * - A section ends at EOF or the next `[Name]` header, whichever comes first - there is
 *   no closing token of any kind, not even an implicit "next #Section" convention (this
 *   isn't `#Section` at all).
 */
export function parseMenuTable(text: string): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  const lines = text.split(/\r\n|\r|\n/);

  let currentSection: string | null = null;
  let sawFilenamesLineForSection = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const semicolonIdx = rawLine.indexOf(";");
    const line = (semicolonIdx === -1 ? rawLine : rawLine.slice(0, semicolonIdx)).trim();
    if (line.length === 0) {
      continue;
    }

    const openBracket = line.indexOf("[");
    if (openBracket !== -1) {
      const closeBracket = line.indexOf("]", openBracket);
      if (closeBracket === -1) {
        diagnostics.push({
          line: i,
          startCol: openBracket,
          endCol: line.length,
          message: `Menu section header "${line.slice(openBracket)}" is missing its closing "]"`,
          severity: "error",
        });
        continue;
      }
      currentSection = line.slice(openBracket + 1, closeBracket).trim();
      sawFilenamesLineForSection = false;
      continue;
    }

    if (currentSection === null) {
      // Real read_menu_tbl() only ever looks for one specific target section name,
      // silently skipping every line before it finds a `[<target>]` header - so content
      // before the FIRST section header anywhere in the file is genuinely never read by
      // any caller, matching the same "loose content" idea as LOOSE_SECTION_NAME
      // elsewhere in this project, but here it's simply inert rather than worth a
      // warning (a menu.tbl with a comment banner before its first section, like every
      // real one seen so far, is completely normal).
      continue;
    }

    const quoteStart = line.indexOf('"');
    if (quoteStart !== -1) {
      const quoteEnd = line.indexOf('"', quoteStart + 1);
      if (quoteEnd === -1) {
        diagnostics.push({
          line: i,
          startCol: quoteStart,
          endCol: line.length,
          message: `Region line's quoted text is missing its closing '"' (menu "${currentSection}")`,
          severity: "error",
        });
        continue;
      }
      const rest = line.slice(quoteEnd + 1).trim();
      const tokens = rest.split(/[\s,]+/).filter((t) => t.length > 0);
      if (tokens.length < 2) {
        diagnostics.push({
          line: i,
          startCol: 0,
          endCol: line.length,
          message: `Region line needs a mask number and a hotkey character after its quoted text, found ${tokens.length} (menu "${currentSection}")`,
          severity: "error",
        });
        continue;
      }
      if (!/^-?\d+$/.test(tokens[0])) {
        diagnostics.push({
          line: i,
          startCol: 0,
          endCol: line.length,
          message: `Region line's mask number "${tokens[0]}" is not an integer (menu "${currentSection}")`,
          severity: "error",
        });
      }
      continue;
    }

    if (!sawFilenamesLineForSection) {
      const tokens = line.split(/[\s,]+/).filter((t) => t.length > 0);
      if (tokens.length < 2) {
        diagnostics.push({
          line: i,
          startCol: 0,
          endCol: line.length,
          message: `Menu "${currentSection}"'s background/mask filenames line needs two filenames, found ${tokens.length}`,
          severity: "error",
        });
      }
      sawFilenamesLineForSection = true;
      continue;
    }

    // A non-blank, non-quoted, non-bracket line here isn't itself a real read_menu_tbl()
    // error - the real strtok()-based filenames branch would just silently reparse and
    // overwrite the section's background/mask filenames with whatever tokens are on
    // this line, no error either way. Still surfaced as a warning (not the generic
    // "Unrecognized line" wording, to make clear this table's grammar IS understood)
    // since a stray line here almost certainly isn't what the author intended.
    diagnostics.push({
      line: i,
      startCol: 0,
      endCol: line.length,
      message: `Unexpected extra background/mask filenames line in menu "${currentSection}" - only the first one after "[${currentSection}]" is meaningful`,
      severity: "warning",
    });
  }

  return diagnostics;
}
