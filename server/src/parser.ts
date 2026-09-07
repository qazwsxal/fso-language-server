/**
 * Tolerant line-oriented parser for FSO .tbl/.tbm files.
 * Mirrors the conventions documented from FSO's own parselo.cpp-style grammar:
 * `;` comments, `#Section` ... `#End`, `$Field: value`, `+Subfield: value`, and
 * `@Field: value` - a third, less common sigil confirmed in weapons.tbl (the
 * laser-visual cluster: `@Laser Bitmap:`, `@Laser Glow:`, `@Laser Color:`, etc.) via a
 * real mod file. Treated like `+` for order-checking purposes (never order-checked -
 * see schemaValidator.ts), just a distinct sigil character.
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

const MULTILINE_END_MARKERS = new Set(["$end_multi_text", "$end_custom_data"]);

export function parseTable(text: string): ParseResult {
  const lines = text.split(/\r\n|\r|\n/);
  const sections: TableSection[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  let currentSection: TableSection | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = stripComment(rawLine).trim();
    if (line.length === 0) {
      continue;
    }

    if (line.startsWith("#")) {
      if (line.toLowerCase() === "#end") {
        if (currentSection) {
          currentSection.endLine = i;
          currentSection = null;
        } else {
          diagnostics.push({
            line: i,
            startCol: 0,
            endCol: rawLine.length,
            message: "#End found with no open #Section",
            severity: "warning",
          });
        }
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
        currentSection = { name: line.slice(1).trim(), startLine: i, endLine: null, entries: [] };
        sections.push(currentSection);
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

      if (countChar(entryValue, '"') % 2 === 1) {
        // An odd quote count means a quoted string was left open on this line - e.g.
        // `+Description: XSTR("` (the quote appears after an "XSTR(" prefix, not at the
        // start of the value, so this can't just check entryValue.startsWith('"')).
        // Consume subsequent lines until one closes it (brings the total to even).
        // This is the ONLY multi-line-continuation heuristic in this parser - an
        // earlier version also auto-collected free text for any colon-having field left
        // with an empty value (intended for a literal-sentinel-terminated block like
        // `$Custom data:`), but that shape is indistinguishable from the extremely
        // common case of a bare "marker" field with ordinary `+Subfield:` children and
        // no free text at all (`$Pspew:`, `$Trail:`, `$Thruster:`, `$MiscAnims:`,
        // `$ThrustAnims:`, etc.) - it scanned forward for the next `$end_multi_text`/
        // `$end_custom_data` ANYWHERE in the file and silently swallowed every entry in
        // between (confirmed against a real weapons.tbl: a weapon's own `$Pspew:` block
        // ate everything up to a much later entry's unrelated description-block
        // terminator). Removed entirely rather than narrowed, since no confirmed
        // real-world table actually relies on it.
        let j = i + 1;
        while (j < lines.length) {
          entryValue += "\n" + lines[j];
          if (countChar(lines[j], '"') >= 1) {
            break;
          }
          j++;
        }
        i = j;
      }

      // A closed multi-line quote (first branch above) is typically immediately
      // followed by its own `$end_multi_text` sentinel line - consume it too so it
      // doesn't show up as its own spurious field entry.
      if (i + 1 < lines.length && MULTILINE_END_MARKERS.has(lines[i + 1].trim())) {
        i += 1;
      }

      if (!currentSection) {
        diagnostics.push({
          line: i,
          startCol: 0,
          endCol: rawLine.length,
          message: `"${sigil}${key}" appears outside of any #Section block`,
          severity: "warning",
        });
        continue;
      }

      currentSection.entries.push({ sigil, key, value: entryValue, line: i, raw: rawLine });
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

/** Strips a `;` line comment, ignoring `;` characters that appear inside a quoted string. */
function stripComment(line: string): string {
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

function countChar(s: string, c: string): number {
  let n = 0;
  for (const ch of s) {
    if (ch === c) {
      n++;
    }
  }
  return n;
}
