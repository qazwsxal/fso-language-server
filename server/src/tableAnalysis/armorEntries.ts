import { TableSection } from "../parser";

export interface ArmorDamageTypeRef {
  line: number;
  /** The damage-type string this armor type applies a multiplier to, e.g. "NormalWeapon" - matched against weapons.tbl's `$Damage Type:`. */
  damageType: string;
}

export interface ArmorEntryInfo {
  name: string;
  nameLine: number;
  damageTypes: ArmorDamageTypeRef[];
  /** Modular-table-only sentinels (see fso-table-format): only relevant when merging .tbm layers. */
  noCreate: boolean;
  remove: boolean;
}

/**
 * Extracts per-armor-type name + damage-type-string info from a parsed armor.tbl/*-amr.tbm.
 *
 * Confirmed from a real armor.tbm: an armor type entry repeats `$Damage Type: <name>`
 * as a top-level `$`-sigil field (NOT `+Damage Type:` as earlier assumed), each followed
 * by nested `+Calculation:`/`+Value:`/`+Weapon Piercing ...:` sub-fields that this
 * reader doesn't need - only the damage-type name itself matters for cross-referencing
 * against weapons.tbl's `$Damage Type:`.
 */
export function extractArmorEntries(sections: TableSection[]): ArmorEntryInfo[] {
  const entries: ArmorEntryInfo[] = [];
  let current: ArmorEntryInfo | null = null;

  for (const section of sections) {
    if (section.name.trim().toLowerCase() !== "armor type") {
      continue;
    }

    for (const field of section.entries) {
      const key = field.key.trim().toLowerCase();

      if (field.sigil === "$" && key === "name") {
        current = { name: field.value.trim(), nameLine: field.line, damageTypes: [], noCreate: false, remove: false };
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

      if (key === "damage type") {
        current.damageTypes.push({ line: field.line, damageType: field.value.trim() });
      }
    }
  }

  return entries;
}
