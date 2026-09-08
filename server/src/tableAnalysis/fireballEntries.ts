import { TableSection } from "../parser";

export interface FireballEntryInfo {
  name: string;
  nameLine: number;
  /** Whether this entry was keyed by `$Unique ID:` rather than `$Name:` (both accepted - see fso-table-fields-reference project memory). */
  keyedByUniqueId: boolean;
  /** Modular-table-only sentinels (see fso-table-format): only relevant when merging .tbm layers. */
  noCreate: boolean;
  remove: boolean;
}

/**
 * Extracts per-fireball-effect identity info from a parsed fireball.tbl/*-fbl.tbm.
 * Confirmed (fso-table-fields-reference project memory, `fireballs.cpp`): the section
 * wrapper is `#Start`/`#End` (see fireball.ts schema), and an entry opens on EITHER
 * `$Name:` or `$Unique ID:` (`required_string_one_of(3, "#End", "$Name:", "$Unique
 * ID:")`) - both are treated as the entry-key field here.
 */
export function extractFireballEntries(sections: TableSection[]): FireballEntryInfo[] {
  const entries: FireballEntryInfo[] = [];
  let current: FireballEntryInfo | null = null;

  for (const section of sections) {
    if (section.name.trim().toLowerCase() !== "start") {
      continue;
    }

    for (const field of section.entries) {
      const key = field.key.trim().toLowerCase();

      if (field.sigil === "$" && (key === "name" || key === "unique id")) {
        current = { name: field.value.trim(), nameLine: field.line, keyedByUniqueId: key === "unique id", noCreate: false, remove: false };
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
