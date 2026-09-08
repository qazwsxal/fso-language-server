import { TableSection } from "../parser";

export interface FireballEntryInfo {
  /** `$Name:` value - always present (required field per `parse_fireball_tbl()`). */
  name: string;
  /** `$Unique ID:` value, if this entry specified one (optional, precedes `$Name:`). */
  uniqueId: string | null;
  nameLine: number;
  /** Whether this entry carried a `$Unique ID:` field (both `$Unique ID:` and `$Name:` are accepted as the identity fields - see fso-table-fields-reference project memory). */
  keyedByUniqueId: boolean;
  /** Modular-table-only sentinels (see fso-table-format): only relevant when merging .tbm layers. */
  noCreate: boolean;
  remove: boolean;
}

/**
 * Extracts per-fireball-effect identity info from a parsed fireball.tbl/*-fbl.tbm.
 * Confirmed (fireballs.cpp's `parse_fireball_tbl()`): the section wrapper is
 * `#Start`/`#End` (see fireball.ts schema), and each entry is `[$Unique ID: ...]`
 * (optional) followed by required `$Name: ...`
 * (`required_string_one_of(3, "#End", "$Name:", "$Unique ID:")` then
 * `required_string("$Name:")`) - so a `$Unique ID:` field belongs to the *next* `$Name:`
 * field, not a separate entry.
 */
export function extractFireballEntries(sections: TableSection[]): FireballEntryInfo[] {
  const entries: FireballEntryInfo[] = [];
  let current: FireballEntryInfo | null = null;
  let pendingUniqueId: string | null = null;

  for (const section of sections) {
    if (section.name.trim().toLowerCase() !== "start") {
      continue;
    }

    for (const field of section.entries) {
      const key = field.key.trim().toLowerCase();

      if (field.sigil === "$" && key === "unique id") {
        pendingUniqueId = field.value.trim();
        continue;
      }
      if (field.sigil === "$" && key === "name") {
        current = {
          name: field.value.trim(),
          uniqueId: pendingUniqueId,
          nameLine: field.line,
          keyedByUniqueId: pendingUniqueId !== null,
          noCreate: false,
          remove: false,
        };
        entries.push(current);
        pendingUniqueId = null;
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
