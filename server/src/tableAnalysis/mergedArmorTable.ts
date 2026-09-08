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
import { SourceLocation } from "./sourceLocation";

export { SourceLocation };

export interface EffectiveDamageType {
  damageType: string;
  location: SourceLocation;
}

export interface EffectiveArmorEntry {
  name: string;
  /** Where this armor type's `$Name:` was (last) set - the "current effective" location, for hover text. */
  nameLocation: SourceLocation | null;
  /** Every location (base .tbl + every .tbm layer, in application order) where this armor type's `$Name:` was touched - for "cycle through every definition" go-to-definition. */
  allLocations: SourceLocation[];
  /** Unique damage-type entries referenced by this armor type's `$Damage Type:` fields, each with where it was (last) set. */
  damageTypes: EffectiveDamageType[];
  /**
   * Every location where THIS armor entry has set a given damage-type string (lowercased
   * key), accumulated across every layer that touched this entry - not just the layer
   * that currently "wins". A later layer fully redeclaring this entry with a different
   * damage-type list still leaves the earlier layer's now-superseded damage type's
   * location in this history: armor.tbl entries are wholesale-replaced (see doc comment
   * below), so the earlier value is no longer *active*, but it genuinely was defined at
   * that location, and "cycle through every place this was defined" is about definition
   * history, not current effective state (that's what `damageTypes` above is for).
   */
  damageTypeLocations: Map<string, SourceLocation[]>;
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

/** All unique damage-type strings (lowercased) referenced anywhere across every armor type in the merged table - for existence checks. */
export function collectAllDamageTypes(armorTable: Map<string, EffectiveArmorEntry>): Set<string> {
  const all = new Set<string>();
  for (const entry of armorTable.values()) {
    for (const dt of entry.damageTypes) {
      all.add(dt.damageType.toLowerCase());
    }
  }
  return all;
}

/** Unique damage-type strings in their original (first-seen) casing - for completion display, where lowercasing would look wrong. */
export function collectDisplayDamageTypes(armorTable: Map<string, EffectiveArmorEntry>): string[] {
  const seen = new Map<string, string>();
  for (const entry of armorTable.values()) {
    for (const dt of entry.damageTypes) {
      const key = dt.damageType.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, dt.damageType);
      }
    }
  }
  return Array.from(seen.values());
}

/** Every location (across every armor type and every layer that ever set it) where `damageType` is set via `$Damage Type:`. */
export function findDamageTypeLocations(
  armorTable: Map<string, EffectiveArmorEntry>,
  damageType: string,
): SourceLocation[] {
  const target = damageType.toLowerCase();
  const locations: SourceLocation[] = [];
  for (const entry of armorTable.values()) {
    const forThisEntry = entry.damageTypeLocations.get(target);
    if (forThisEntry) {
      locations.push(...forThisEntry);
    }
  }
  return locations;
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

    const merged: EffectiveArmorEntry =
      existing ?? { name: entry.name, nameLocation: null, allLocations: [], damageTypes: [], damageTypeLocations: new Map(), layerSources: [] };
    merged.nameLocation = { resolved, line: entry.nameLine };
    merged.allLocations = [...merged.allLocations, { resolved, line: entry.nameLine }];
    if (entry.damageTypes.length > 0) {
      merged.damageTypes = entry.damageTypes.map((d) => ({
        damageType: d.damageType,
        location: { resolved, line: d.line },
      }));
      for (const d of entry.damageTypes) {
        const dtKey = d.damageType.toLowerCase();
        const existingLocs = merged.damageTypeLocations.get(dtKey) ?? [];
        merged.damageTypeLocations.set(dtKey, [...existingLocs, { resolved, line: d.line }]);
      }
    }
    merged.layerSources = [...merged.layerSources, sourceLabel];

    result.set(key, merged);
  }
}
