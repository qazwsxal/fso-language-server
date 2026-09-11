import { parseTable } from "../parser";
import { extractSpeciesEntries } from "./speciesEntries";
import {
  resolveFile,
  listMatchingFiles,
  readResolvedFile,
  basenameOfResolved,
  describeResolvedSource,
  ResolvedFile,
} from "../modResolution/resolver";
import { SourceLocation } from "./sourceLocation";
import { BUILTIN_SPECIES_DEFS_TBL } from "./builtinTableDefaults";

export interface EffectiveSpeciesEntry {
  name: string;
  nameLocation: SourceLocation | null;
  /** Every location (base .tbl + every .tbm layer, in application order) where this species' `$Species_Name:` was touched - for "cycle through every definition" go-to-definition. */
  allLocations: SourceLocation[];
  layerSources: string[];
}

/**
 * Builds the "effective" merged species_defs.tbl view, mirroring
 * buildEffectiveArmorTable() - same base-.tbl-plus-.tbm-layers merge order, `-sdf.tbm`
 * suffix (confirmed in speciesDefs.ts schema).
 */
export function buildEffectiveSpeciesTable(searchDirs: string[]): Map<string, EffectiveSpeciesEntry> {
  const result = new Map<string, EffectiveSpeciesEntry>();

  const baseResolved = resolveFile(searchDirs, "data/tables/species_defs.tbl");
  if (baseResolved) {
    applyLayer(result, baseResolved, /* isBase */ true);
  } else {
    // No real species_defs.tbl anywhere on the search path - confirmed a real scenario
    // for a Knossos-managed install whose dependency chain bottoms out at retail (see
    // builtinTableDefaults.ts): FSO itself falls back to a compiled-in default here
    // rather than having no species at all.
    applyBuiltinDefaultLayer(result, BUILTIN_SPECIES_DEFS_TBL);
  }

  for (const dir of [...searchDirs].reverse()) {
    const tbmFiles = listMatchingFiles(dir, /-sdf\.tbm$/i).sort((a, b) =>
      basenameOfResolved(b).localeCompare(basenameOfResolved(a)),
    );
    for (const resolved of tbmFiles) {
      applyLayer(result, resolved, /* isBase */ false);
    }
  }

  return result;
}

/** Unique species names in their original (first-seen) casing - for completion display. */
export function collectDisplaySpeciesNames(speciesTable: Map<string, EffectiveSpeciesEntry>): string[] {
  return Array.from(speciesTable.values()).map((e) => e.name);
}

/**
 * Same effect as applyLayer() for the base layer, but for FSO's compiled-in default text
 * (see builtinTableDefaults.ts) rather than a real file - so there's no ResolvedFile to
 * attach a go-to-definition target to. Entries get `nameLocation: null`/empty
 * `allLocations` (go-to-definition on a species that exists only via this synthetic
 * layer correctly finds nowhere to jump), but DO exist in the map, which is what every
 * cross-reference check actually needs.
 */
function applyBuiltinDefaultLayer(result: Map<string, EffectiveSpeciesEntry>, text: string): void {
  const entries = extractSpeciesEntries(parseTable(text).sections);
  for (const entry of entries) {
    result.set(entry.name.toLowerCase(), {
      name: entry.name,
      nameLocation: null,
      allLocations: [],
      layerSources: ["(FSO built-in default)"],
    });
  }
}

function applyLayer(result: Map<string, EffectiveSpeciesEntry>, resolved: ResolvedFile, isBase: boolean): void {
  let text: string;
  try {
    text = readResolvedFile(resolved).toString("utf8");
  } catch {
    return;
  }

  const parsed = parseTable(text);
  const entries = extractSpeciesEntries(parsed.sections);
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

    const merged: EffectiveSpeciesEntry =
      existing ?? { name: entry.name, nameLocation: null, allLocations: [], layerSources: [] };
    merged.nameLocation = { resolved, line: entry.nameLine };
    merged.allLocations = [...merged.allLocations, { resolved, line: entry.nameLine }];
    merged.layerSources = [...merged.layerSources, sourceLabel];

    result.set(key, merged);
  }
}
