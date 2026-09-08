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

export interface EffectiveSpeciesEntry {
  name: string;
  nameLocation: SourceLocation | null;
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

    const merged: EffectiveSpeciesEntry = existing ?? { name: entry.name, nameLocation: null, layerSources: [] };
    merged.nameLocation = { resolved, line: entry.nameLine };
    merged.layerSources = [...merged.layerSources, sourceLabel];

    result.set(key, merged);
  }
}
