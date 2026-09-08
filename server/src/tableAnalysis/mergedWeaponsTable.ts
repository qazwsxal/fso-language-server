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
import { SourceLocation } from "./sourceLocation";
import { FieldMapEntry, applyNamedFieldRefs } from "./fieldMapMerge";

export interface EffectiveWeaponEntry {
  name: string;
  /** Where this weapon's `$Name:` was (last) set - for go-to-definition from a ship's `$Default PBanks:`/`$Default SBanks:` weapon-name list. */
  nameLocation: SourceLocation | null;
  /** Every location (base .tbl + every .tbm layer, in application order) where this weapon's `$Name:` was touched - for "cycle through every definition" go-to-definition. */
  allLocations: SourceLocation[];
  modelFile: string | null;
  modelFileSource: string | null;
  damageType: string | null;
  damageTypeSource: string | null;
  /** One entry per sound-referencing field actually set by any layer (e.g. "impactsnd" -> {value, source}) - see fieldMapMerge.ts. */
  soundsByField: Map<string, FieldMapEntry>;
  /** Same shape as soundsByField, for texture/animation-referencing fields. */
  texturesByField: Map<string, FieldMapEntry>;
  /** Every file that touched this entry, in application order (base .tbl first, then .tbm layers lowest-to-highest priority). */
  layerSources: string[];
}

/** Unique weapon names in their original (first-seen) casing - for completion display, where lowercasing would look wrong. */
export function collectDisplayWeaponNames(weaponsTable: Map<string, EffectiveWeaponEntry>): string[] {
  return Array.from(weaponsTable.values()).map((e) => e.name);
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
        nameLocation: null,
        allLocations: [],
        modelFile: null,
        modelFileSource: null,
        damageType: null,
        damageTypeSource: null,
        soundsByField: new Map(),
        texturesByField: new Map(),
        layerSources: [],
      };

    merged.nameLocation = { resolved, line: entry.nameLine };
    merged.allLocations = [...merged.allLocations, { resolved, line: entry.nameLine }];
    if (entry.modelFile) {
      merged.modelFile = entry.modelFile;
      merged.modelFileSource = sourceLabel;
    }
    if (entry.damageType) {
      merged.damageType = entry.damageType;
      merged.damageTypeSource = sourceLabel;
    }
    applyNamedFieldRefs(merged.soundsByField, entry.soundRefs, sourceLabel);
    applyNamedFieldRefs(merged.texturesByField, entry.textureRefs, sourceLabel);
    merged.layerSources = [...merged.layerSources, sourceLabel];

    result.set(key, merged);
  }
}
