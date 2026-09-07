import { parseTable } from "../parser";
import { extractWeaponEntries } from "./weaponEntries";
import {
  resolveFile,
  listMatchingFiles,
  readResolvedFile,
  basenameOfResolved,
  describeResolvedSource,
  ResolvedFile,
} from "../modResolution/resolver";

export interface EffectiveWeaponEntry {
  name: string;
  modelFile: string | null;
  modelFileSource: string | null;
  /** Every file that touched this entry, in application order (base .tbl first, then .tbm layers lowest-to-highest priority). */
  layerSources: string[];
}

/**
 * Builds the "effective" merged weapons.tbl view across the whole active mod's search
 * path, mirroring buildEffectiveShipTable() in mergedShipTable.ts - same merge
 * algorithm (base .tbl from the single highest-priority directory, all matching
 * `-wep.tbm` applied lowest-to-highest priority, same-directory ties broken
 * reverse-alphabetically), just for weapons.tbl's `$Model File:` instead of ships.tbl's
 * richer field set. See that module's doc comment for the full rationale.
 */
export function buildEffectiveWeaponsTable(searchDirs: string[]): Map<string, EffectiveWeaponEntry> {
  const result = new Map<string, EffectiveWeaponEntry>();

  const baseResolved = resolveFile(searchDirs, "data/tables/weapons.tbl");
  if (baseResolved) {
    applyLayer(result, baseResolved, /* isBase */ true);
  }

  for (const dir of [...searchDirs].reverse()) {
    const tbmFiles = listMatchingFiles(dir, /-wep\.tbm$/i).sort((a, b) =>
      basenameOfResolved(b).localeCompare(basenameOfResolved(a)),
    );
    for (const resolved of tbmFiles) {
      applyLayer(result, resolved, /* isBase */ false);
    }
  }

  return result;
}

function applyLayer(result: Map<string, EffectiveWeaponEntry>, resolved: ResolvedFile, isBase: boolean): void {
  let text: string;
  try {
    text = readResolvedFile(resolved).toString("utf8");
  } catch {
    return;
  }

  const parsed = parseTable(text);
  const entries = extractWeaponEntries(parsed.sections);
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

    const merged: EffectiveWeaponEntry =
      existing ?? {
        name: entry.name,
        modelFile: null,
        modelFileSource: null,
        layerSources: [],
      };

    if (entry.modelFile) {
      merged.modelFile = entry.modelFile;
      merged.modelFileSource = sourceLabel;
    }
    merged.layerSources = [...merged.layerSources, sourceLabel];

    result.set(key, merged);
  }
}
