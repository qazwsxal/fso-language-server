import { TableSection } from "../parser";

export interface SpeciesEntryInfo {
  name: string;
  nameLine: number;
  /** From `$Default IFF:` - references an iff_defs.tbl `$IFF Name:` entry (e.g. "Friendly", "Hostile"). */
  defaultIff: string | null;
  defaultIffLine: number | null;
  /** Modular-table-only sentinels (see fso-table-format): only relevant when merging .tbm layers. */
  noCreate: boolean;
  remove: boolean;
}

/**
 * Extracts per-species name info from a parsed species_defs.tbl/*-sdf.tbm.
 *
 * Confirmed against a real bp-sdf.tbm (see speciesDefs.ts schema doc comment): entries
 * are keyed by `$Species_Name:` (underscore), section is `#Species Defs`.
 */
export function extractSpeciesEntries(sections: TableSection[]): SpeciesEntryInfo[] {
  const entries: SpeciesEntryInfo[] = [];
  let current: SpeciesEntryInfo | null = null;

  for (const section of sections) {
    if (section.name.trim().toLowerCase() !== "species defs") {
      continue;
    }

    for (const field of section.entries) {
      const key = field.key.trim().toLowerCase();

      if (field.sigil === "$" && key === "species_name") {
        current = { name: field.value.trim(), nameLine: field.line, defaultIff: null, defaultIffLine: null, noCreate: false, remove: false };
        entries.push(current);
        continue;
      }
      if (!current) {
        continue;
      }

      if (field.sigil === "+") {
        if (key === "nocreate") {
          current.noCreate = true;
        } else if (key === "remove") {
          current.remove = true;
        }
        continue;
      }

      if (key === "default iff") {
        current.defaultIff = field.value.trim();
        current.defaultIffLine = field.line;
      }
    }
  }

  return entries;
}
