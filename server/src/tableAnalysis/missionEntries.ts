import { FieldEntry, TableSection } from "../parser";

/** A single cross-referencing value at a specific position - $Class: under #Objects (a ship-class name, referencing ships.tbl's $Name:). */
export interface MissionFieldRef {
  line: number;
  value: string;
}

/**
 * A single quoted name inside a `( "Name" ... )`-style list field, with its OWN real
 * source line - not the field's line, since these lists (a real thrash_test.fs2's
 * $Ship Choices: runs to ~20 lines, one name per line) routinely span many physical
 * lines and parser.ts's multi-line continuation only records the LAST consumed line on
 * the FieldEntry itself (see parser.ts's `i = j - 1` before the entry is pushed). Each
 * name needs its actual line so hover/go-to-definition work no matter which line of the
 * list the user is actually looking at, not just the closing `)` line.
 */
export interface MissionNameRef {
  line: number;
  name: string;
}

export interface MissionEntryInfo {
  /** `$Class:` under `#Objects` - each mission ship object's class, references ships.tbl's `$Name:`. One per ship object (not a list). */
  shipClassRefs: MissionFieldRef[];
  /** `+Primary Banks:`/`+Secondary Banks:` under `#Objects` - references weapons.tbl's `$Name:`, same convention as ships.tbl's own `$Default PBanks:`/`$Default SBanks:`. */
  weaponBankRefs: MissionNameRef[];
  /** `$Ship Choices:` under `#Players` - ship class names (each followed by a pilot-selectable count) offered at mission start, references ships.tbl's `$Name:`. */
  shipChoiceRefs: MissionNameRef[];
  /** `+Weaponry Pool:` under `#Players` - weapon names (each followed by a stock count) available for loadout, references weapons.tbl's `$Name:`. */
  weaponryPoolRefs: MissionNameRef[];
}

/**
 * Splits a field's (possibly multi-line-joined, see MissionNameRef's doc comment) value
 * into one MissionNameRef per quoted name, each carrying its own real source line.
 */
function extractNameRefs(field: FieldEntry): MissionNameRef[] {
  const physicalLines = field.value.split("\n");
  const firstLine = field.line - (physicalLines.length - 1);
  const refs: MissionNameRef[] = [];
  physicalLines.forEach((lineText, idx) => {
    const lineNumber = firstLine + idx;
    for (const m of lineText.matchAll(/"([^"]*)"/g)) {
      refs.push({ line: lineNumber, name: m[1].trim() });
    }
  });
  return refs;
}

/**
 * Extracts every ship-class/weapon-name cross-reference from a parsed .fs2/.fc2 mission
 * file - confirmed against a real thrash_test.fs2 (benchmark mission) and BWO Demo
 * missions: `#Objects` entries carry `$Class:` (a ships.tbl class name) plus per-ship
 * `+Primary Banks:`/`+Secondary Banks:` weapon-name lists identical in shape to
 * ships.tbl's own bank fields; `#Players` carries `$Ship Choices:`/`+Weaponry Pool:`,
 * each a `( "Name" count "Name" count ... )` list (count ignored here, same
 * quoted-names-only extraction already used for ships.tbl bank lists).
 * Deliberately narrow: this project's mission support is cross-referencing only, not
 * full mission parsing (`#Events`/`#Goals` use FSO's SEXP s-expression grammar, a
 * completely different structure this parser doesn't attempt).
 */
export function extractMissionEntries(sections: TableSection[]): MissionEntryInfo {
  const shipClassRefs: MissionFieldRef[] = [];
  const weaponBankRefs: MissionNameRef[] = [];
  const shipChoiceRefs: MissionNameRef[] = [];
  const weaponryPoolRefs: MissionNameRef[] = [];

  for (const section of sections) {
    const sectionName = section.name.trim().toLowerCase();

    if (sectionName === "objects") {
      for (const field of section.entries) {
        const key = field.key.trim().toLowerCase();
        if (field.sigil === "$" && key === "class" && field.value.trim()) {
          shipClassRefs.push({ line: field.line, value: field.value.trim() });
        } else if (field.sigil === "+" && (key === "primary banks" || key === "secondary banks")) {
          weaponBankRefs.push(...extractNameRefs(field));
        }
      }
    } else if (sectionName === "players") {
      for (const field of section.entries) {
        const key = field.key.trim().toLowerCase();
        if (field.sigil === "$" && key === "ship choices") {
          shipChoiceRefs.push(...extractNameRefs(field));
        } else if (field.sigil === "+" && key === "weaponry pool") {
          weaponryPoolRefs.push(...extractNameRefs(field));
        }
      }
    }
  }

  return { shipClassRefs, weaponBankRefs, shipChoiceRefs, weaponryPoolRefs };
}
