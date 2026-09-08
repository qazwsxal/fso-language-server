import { TableSection } from "../parser";

export interface IffEntryInfo {
  name: string;
  nameLine: number;
  /** Modular-table-only sentinels (see fso-table-format): only relevant when merging .tbm layers. */
  noCreate: boolean;
  remove: boolean;
}

/**
 * Extracts per-IFF name info from a parsed iff_defs.tbl/*-iff.tbm.
 *
 * Confirmed against FSO's iff_defs.cpp (see iffDefs.ts schema doc comment): the section
 * is `#IFFs` and entries are keyed by `$IFF Name:`.
 */
export function extractIffEntries(sections: TableSection[]): IffEntryInfo[] {
  const entries: IffEntryInfo[] = [];
  let current: IffEntryInfo | null = null;

  for (const section of sections) {
    if (section.name.trim().toLowerCase() !== "iffs") {
      continue;
    }

    for (const field of section.entries) {
      const key = field.key.trim().toLowerCase();

      if (field.sigil === "$" && key === "iff name") {
        current = { name: field.value.trim(), nameLine: field.line, noCreate: false, remove: false };
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
      }
    }
  }

  return entries;
}
