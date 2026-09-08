import { TableSection } from "../parser";

export type ObjectTypeSectionKind = "target-priorities" | "weapon-targeting-priorities" | "ship-types";

const SECTION_KIND_BY_NAME: Record<string, ObjectTypeSectionKind> = {
  "target priorities": "target-priorities",
  "weapon targeting priorities": "weapon-targeting-priorities",
  "ship types": "ship-types",
};

export interface ObjectTypeEntryInfo {
  kind: ObjectTypeSectionKind;
  name: string;
  nameLine: number;
  /** Modular-table-only sentinels (see fso-table-format): only relevant when merging .tbm layers. */
  noCreate: boolean;
  remove: boolean;
}

/**
 * Extracts per-entry identity info from a parsed objecttypes.tbl/*-obt.tbm. objecttypes.tbl
 * has three independently-optional sections with quite different field sets (confirmed -
 * fso-table-fields-reference project memory, `ship.cpp`'s `parse_shiptype_tbl()`) -
 * `#Target Priorities`, `#Weapon Targeting Priorities`, `#Ship Types` - each closed with
 * a plain `#End`. Entries are tagged with which section (`kind`) they came from, since a
 * `$Name:` in one section (e.g. a target-priority group) has no relation to a
 * same-named entry in another (e.g. a ship type).
 */
export function extractObjectTypeEntries(sections: TableSection[]): ObjectTypeEntryInfo[] {
  const entries: ObjectTypeEntryInfo[] = [];

  for (const section of sections) {
    const kind = SECTION_KIND_BY_NAME[section.name.trim().toLowerCase()];
    if (!kind) {
      continue;
    }

    let current: ObjectTypeEntryInfo | null = null;
    for (const field of section.entries) {
      const key = field.key.trim().toLowerCase();

      if (field.sigil === "$" && key === "name") {
        current = { kind, name: field.value.trim(), nameLine: field.line, noCreate: false, remove: false };
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
