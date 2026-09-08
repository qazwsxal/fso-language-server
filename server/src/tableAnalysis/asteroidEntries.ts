import { TableSection } from "../parser";

export interface AsteroidEntryInfo {
  name: string;
  nameLine: number;
  /** Modular-table-only sentinels (see fso-table-format): only relevant when merging .tbm layers. */
  noCreate: boolean;
  remove: boolean;
}

/** Extracts per-asteroid-type name info from a parsed asteroid.tbl/*-ast.tbm (see asteroid.ts schema). */
export function extractAsteroidEntries(sections: TableSection[]): AsteroidEntryInfo[] {
  const entries: AsteroidEntryInfo[] = [];
  let current: AsteroidEntryInfo | null = null;

  for (const section of sections) {
    if (section.name.trim().toLowerCase() !== "asteroid types") {
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
