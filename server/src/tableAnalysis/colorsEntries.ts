import { TableSection } from "../parser";

export interface TeamColorEntryInfo {
  name: string;
  nameLine: number;
}

/**
 * Extracts colors.tbl `#Team Colors` entries from a parsed colors.tbl/*-clr.tbm -
 * confirmed against code/globalincs/alphacolors.cpp's `parse_everything_else()`:
 * `#Team Colors` ... `#End`, entries keyed by `$Team Name:`, each followed by
 * `$Team Stripe Color:`/`$Team Base Color:` (or the British `Colour` spelling) RGB
 * triples - neither of which is a cross-reference, so not tracked here. No
 * `+nocreate`/`+remove` sentinel support at all (confirmed - the parser just does an
 * unconditional `Team_Colors[name] = color`), unlike every other modular table in this
 * codebase.
 */
export function extractColorsEntries(sections: TableSection[]): TeamColorEntryInfo[] {
  const entries: TeamColorEntryInfo[] = [];

  for (const section of sections) {
    if (section.name.trim().toLowerCase() !== "team colors") {
      continue;
    }

    for (const field of section.entries) {
      const key = field.key.trim().toLowerCase();
      if (field.sigil === "$" && key === "team name" && field.value.trim()) {
        entries.push({ name: field.value.trim(), nameLine: field.line });
      }
    }
  }

  return entries;
}
