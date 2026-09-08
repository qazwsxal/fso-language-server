import { parseTable } from "../parser";
import { extractAsteroidEntries } from "./asteroidEntries";
import {
  resolveFile,
  listMatchingFiles,
  readResolvedFile,
  basenameOfResolved,
  describeResolvedSource,
  ResolvedFile,
} from "../modResolution/resolver";
import { SourceLocation } from "./sourceLocation";

export interface EffectiveAsteroidEntry {
  name: string;
  nameLocation: SourceLocation | null;
  /** Every location (base .tbl + every .tbm layer, in application order) where this asteroid type's `$Name:` was touched - for "cycle through every definition" go-to-definition. */
  allLocations: SourceLocation[];
  layerSources: string[];
}

/**
 * Builds the "effective" merged asteroid.tbl view, mirroring buildEffectiveAiClassTable()/
 * buildEffectiveArmorTable() - same base-.tbl-plus-.tbm-layers merge order, `-ast.tbm`
 * suffix (confirmed in asteroid.ts schema).
 */
export function buildEffectiveAsteroidTable(searchDirs: string[]): Map<string, EffectiveAsteroidEntry> {
  const result = new Map<string, EffectiveAsteroidEntry>();

  const baseResolved = resolveFile(searchDirs, "data/tables/asteroid.tbl");
  if (baseResolved) {
    applyLayer(result, baseResolved, /* isBase */ true);
  }

  for (const dir of [...searchDirs].reverse()) {
    const tbmFiles = listMatchingFiles(dir, /-ast\.tbm$/i).sort((a, b) =>
      basenameOfResolved(b).localeCompare(basenameOfResolved(a)),
    );
    for (const resolved of tbmFiles) {
      applyLayer(result, resolved, /* isBase */ false);
    }
  }

  return result;
}

/** Unique asteroid type names in their original (first-seen) casing - for completion display. */
export function collectDisplayAsteroidNames(asteroidTable: Map<string, EffectiveAsteroidEntry>): string[] {
  return Array.from(asteroidTable.values()).map((e) => e.name);
}

function applyLayer(result: Map<string, EffectiveAsteroidEntry>, resolved: ResolvedFile, isBase: boolean): void {
  let text: string;
  try {
    text = readResolvedFile(resolved).toString("utf8");
  } catch {
    return;
  }

  const parsed = parseTable(text);
  const entries = extractAsteroidEntries(parsed.sections);
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

    const merged: EffectiveAsteroidEntry = existing ?? { name: entry.name, nameLocation: null, allLocations: [], layerSources: [] };
    merged.nameLocation = { resolved, line: entry.nameLine };
    merged.allLocations = [...merged.allLocations, { resolved, line: entry.nameLine }];
    merged.layerSources = [...merged.layerSources, sourceLabel];

    result.set(key, merged);
  }
}
