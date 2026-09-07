import { parseTable } from "../parser";
import { extractArmorEntries } from "./armorEntries";
import {
  resolveFile,
  listMatchingFiles,
  readResolvedFile,
  basenameOfResolved,
  describeResolvedSource,
  ResolvedFile,
} from "../modResolution/resolver";

export interface EffectiveArmorEntry {
  name: string;
  /** Unique damage-type strings referenced by this armor type's `+Damage Type:` entries. */
  damageTypes: string[];
  layerSources: string[];
}

/**
 * Builds the "effective" merged armor.tbl view, mirroring buildEffectiveShipTable() /
 * buildEffectiveWeaponsTable() - same base-.tbl-plus-.tbm-layers merge order. armor.tbl
 * is one of FSO's non-XMT tables (see fso-table-format project memory: a duplicate
 * entry without `+nocreate` may be silently discarded by the real engine rather than
 * merged field-by-field), so a later layer's entry for the same armor name replaces its
 * damage-type list wholesale here too - consistent with, not stricter than, the other
 * merge modules' simplified fidelity.
 */
export function buildEffectiveArmorTable(searchDirs: string[]): Map<string, EffectiveArmorEntry> {
  const result = new Map<string, EffectiveArmorEntry>();

  const baseResolved = resolveFile(searchDirs, "data/tables/armor.tbl");
  if (baseResolved) {
    applyLayer(result, baseResolved, /* isBase */ true);
  }

  for (const dir of [...searchDirs].reverse()) {
    const tbmFiles = listMatchingFiles(dir, /-amr\.tbm$/i).sort((a, b) =>
      basenameOfResolved(b).localeCompare(basenameOfResolved(a)),
    );
    for (const resolved of tbmFiles) {
      applyLayer(result, resolved, /* isBase */ false);
    }
  }

  return result;
}

/** All unique damage-type strings (lowercased) referenced anywhere across every armor type in the merged table. */
export function collectAllDamageTypes(armorTable: Map<string, EffectiveArmorEntry>): Set<string> {
  const all = new Set<string>();
  for (const entry of armorTable.values()) {
    for (const dt of entry.damageTypes) {
      all.add(dt.toLowerCase());
    }
  }
  return all;
}

function applyLayer(result: Map<string, EffectiveArmorEntry>, resolved: ResolvedFile, isBase: boolean): void {
  let text: string;
  try {
    text = readResolvedFile(resolved).toString("utf8");
  } catch {
    return;
  }

  const parsed = parseTable(text);
  const entries = extractArmorEntries(parsed.sections);
  const sourceLabel = describeResolvedSource(resolved);

  for (const entry of entries) {
    const key = entry.name.toLowerCase();

    if (!isBase && entry.remove) {
      result.delete(key);
      continue;
    }

    const existing = result.get(key);
    if (!isBase && !existing && entry.noCreate) {
      continue;
    }

    const merged: EffectiveArmorEntry = existing ?? { name: entry.name, damageTypes: [], layerSources: [] };
    if (entry.damageTypes.length > 0) {
      merged.damageTypes = entry.damageTypes.map((d) => d.damageType);
    }
    merged.layerSources = [...merged.layerSources, sourceLabel];

    result.set(key, merged);
  }
}
