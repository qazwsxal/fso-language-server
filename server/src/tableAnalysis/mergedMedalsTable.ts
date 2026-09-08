import { parseTable } from "../parser";
import { extractMedalEntries } from "./medalsEntries";
import {
  resolveFile,
  listMatchingFiles,
  readResolvedFile,
  basenameOfResolved,
  describeResolvedSource,
  ResolvedFile,
} from "../modResolution/resolver";
import { SourceLocation } from "./sourceLocation";

export interface EffectiveMedalEntry {
  name: string;
  nameLocation: SourceLocation | null;
  allLocations: SourceLocation[];
  layerSources: string[];
}

/**
 * Builds the "effective" merged medals.tbl view, mirroring buildEffectiveAsteroidTable() -
 * same base-.tbl-plus-.tbm-layers merge order, `-mdl.tbm` suffix (confirmed live against
 * `code/stats/medals.cpp` - see medals.ts schema; an earlier `-med.tbm` guess meant this
 * never matched a single real .tbm).
 */
export function buildEffectiveMedalsTable(searchDirs: string[]): Map<string, EffectiveMedalEntry> {
  const result = new Map<string, EffectiveMedalEntry>();

  const baseResolved = resolveFile(searchDirs, "data/tables/medals.tbl");
  if (baseResolved) {
    applyLayer(result, baseResolved, /* isBase */ true);
  }

  for (const dir of [...searchDirs].reverse()) {
    const tbmFiles = listMatchingFiles(dir, /-mdl\.tbm$/i).sort((a, b) =>
      basenameOfResolved(b).localeCompare(basenameOfResolved(a)),
    );
    for (const resolved of tbmFiles) {
      applyLayer(result, resolved, /* isBase */ false);
    }
  }

  return result;
}

/** Unique medal names in their original (first-seen) casing - for completion display. */
export function collectDisplayMedalNames(medalsTable: Map<string, EffectiveMedalEntry>): string[] {
  return Array.from(medalsTable.values()).map((e) => e.name);
}

function applyLayer(result: Map<string, EffectiveMedalEntry>, resolved: ResolvedFile, isBase: boolean): void {
  let text: string;
  try {
    text = readResolvedFile(resolved).toString("utf8");
  } catch {
    return;
  }

  const parsed = parseTable(text);
  const entries = extractMedalEntries(parsed.sections);
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

    const merged: EffectiveMedalEntry = existing ?? { name: entry.name, nameLocation: null, allLocations: [], layerSources: [] };
    merged.nameLocation = { resolved, line: entry.nameLine };
    merged.allLocations = [...merged.allLocations, { resolved, line: entry.nameLine }];
    merged.layerSources = [...merged.layerSources, sourceLabel];

    result.set(key, merged);
  }
}
