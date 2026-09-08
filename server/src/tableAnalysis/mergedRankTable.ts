import { parseTable } from "../parser";
import { extractRankEntries } from "./rankEntries";
import {
  resolveFile,
  listMatchingFiles,
  readResolvedFile,
  basenameOfResolved,
  describeResolvedSource,
  ResolvedFile,
} from "../modResolution/resolver";
import { SourceLocation } from "./sourceLocation";

export interface EffectiveRankEntry {
  name: string;
  nameLocation: SourceLocation | null;
  allLocations: SourceLocation[];
  layerSources: string[];
}

/**
 * Builds the "effective" merged rank.tbl view, mirroring buildEffectiveAsteroidTable() -
 * same base-.tbl-plus-.tbm-layers merge order, `-rnk.tbm` suffix (confirmed in rank.ts
 * schema). See rankEntries.ts for how rank.tbl's optional/absent section header is
 * handled - the file is already identified as rank.tbl by filename here (matching how
 * the real engine dispatches to parse_rank_table()), so no in-file marker is required.
 */
export function buildEffectiveRankTable(searchDirs: string[]): Map<string, EffectiveRankEntry> {
  const result = new Map<string, EffectiveRankEntry>();

  const baseResolved = resolveFile(searchDirs, "data/tables/rank.tbl");
  if (baseResolved) {
    applyLayer(result, baseResolved, /* isBase */ true);
  }

  for (const dir of [...searchDirs].reverse()) {
    const tbmFiles = listMatchingFiles(dir, /-rnk\.tbm$/i).sort((a, b) =>
      basenameOfResolved(b).localeCompare(basenameOfResolved(a)),
    );
    for (const resolved of tbmFiles) {
      applyLayer(result, resolved, /* isBase */ false);
    }
  }

  return result;
}

/** Unique rank names in their original (first-seen) casing - for completion display. */
export function collectDisplayRankNames(rankTable: Map<string, EffectiveRankEntry>): string[] {
  return Array.from(rankTable.values()).map((e) => e.name);
}

function applyLayer(result: Map<string, EffectiveRankEntry>, resolved: ResolvedFile, isBase: boolean): void {
  let text: string;
  try {
    text = readResolvedFile(resolved).toString("utf8");
  } catch {
    return;
  }

  const parsed = parseTable(text);
  const entries = extractRankEntries(parsed.sections);
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

    const merged: EffectiveRankEntry = existing ?? { name: entry.name, nameLocation: null, allLocations: [], layerSources: [] };
    merged.nameLocation = { resolved, line: entry.nameLine };
    merged.allLocations = [...merged.allLocations, { resolved, line: entry.nameLine }];
    merged.layerSources = [...merged.layerSources, sourceLabel];

    result.set(key, merged);
  }
}
