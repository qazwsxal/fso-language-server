import { TableSection } from "../parser";

export interface MflashEntryInfo {
  name: string;
  /** Line of the `+name:` sub-field that actually carries the identity (NOT the `$Mflash:` marker line above it, which has no value of its own) - confirmed against code/weapon/muzzleflash.cpp's `parse_mflash_tbl()`. */
  nameLine: number;
}

/**
 * Extracts mflash.tbl `#Muzzle flash types` entries from a parsed mflash.tbl/*-mfl.tbm -
 * the `$Muzzleflash:` cross-reference target (see weapons.cpp). Confirmed against
 * muzzleflash.cpp: each entry is a bare `$Mflash:` marker (no value on that line) whose
 * real name comes from the very next `+name:` sub-field, followed by an optional
 * `+override` flag and a repeatable `+blob_name:`/`+blob_offset:`/`+blob_radius:` list -
 * none of which are cross-references, so not tracked here. Merge is name-keyed with an
 * explicit `+override` flag rather than `+nocreate`/`+remove` (a first-match-wins default
 * with a warning if `+override` is absent) - existence-checking purposes don't need that
 * distinction, so mergedMflashTable.ts just lets a later layer's entry always overwrite.
 */
export function extractMflashEntries(sections: TableSection[]): MflashEntryInfo[] {
  const entries: MflashEntryInfo[] = [];
  let awaitingName = false;

  for (const section of sections) {
    if (section.name.trim().toLowerCase() !== "muzzle flash types") {
      continue;
    }

    for (const field of section.entries) {
      const key = field.key.trim().toLowerCase();

      if (field.sigil === "$" && key === "mflash") {
        awaitingName = true;
        continue;
      }

      if (awaitingName && field.sigil === "+" && key === "name" && field.value.trim()) {
        entries.push({ name: field.value.trim(), nameLine: field.line });
        awaitingName = false;
      }
    }
  }

  return entries;
}
