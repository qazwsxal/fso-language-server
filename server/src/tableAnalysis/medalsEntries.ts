import { TableSection } from "../parser";

export interface MedalEntryInfo {
  name: string;
  nameLine: number;
  /** Modular-table-only sentinels (see fso-table-format): only relevant when merging .tbm layers. */
  noCreate: boolean;
  remove: boolean;
}

/** Extracts per-medal name info from a parsed medals.tbl/*-mdl.tbm (see medals.ts schema). */
export function extractMedalEntries(sections: TableSection[]): MedalEntryInfo[] {
  const entries: MedalEntryInfo[] = [];
  let current: MedalEntryInfo | null = null;

  for (const section of sections) {
    if (section.name.trim().toLowerCase() !== "medals") {
      continue;
    }

    for (const field of section.entries) {
      const key = field.key.trim().toLowerCase();

      if (field.sigil === "$" && key === "name") {
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
