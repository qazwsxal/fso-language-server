import { parseTable } from "../parser";
import { extractAiProfileEntries } from "./aiProfilesEntries";
import {
  resolveFile,
  listMatchingFiles,
  readResolvedFile,
  basenameOfResolved,
  describeResolvedSource,
  ResolvedFile,
} from "../modResolution/resolver";
import { SourceLocation } from "./sourceLocation";

export interface EffectiveAiProfileEntry {
  name: string;
  nameLocation: SourceLocation | null;
  allLocations: SourceLocation[];
  layerSources: string[];
}

/**
 * Builds the "effective" merged ai_profiles.tbl view, mirroring buildEffectiveAiClassTable() -
 * same base-.tbl-plus-.tbm-layers merge order, `-aip.tbm` suffix (confirmed in
 * aiProfiles.ts schema). ai_profiles.tbl is one of FSO's hardcoded-fallback tables (see
 * fso-table-format project memory) - a missing base ai_profiles.tbl on disk is not an
 * error, it just means no base layer is applied here (mirroring the real engine falling
 * back to its built-in default, which this LSP has no access to).
 */
export function buildEffectiveAiProfilesTable(searchDirs: string[]): Map<string, EffectiveAiProfileEntry> {
  const result = new Map<string, EffectiveAiProfileEntry>();

  const baseResolved = resolveFile(searchDirs, "data/tables/ai_profiles.tbl");
  if (baseResolved) {
    applyLayer(result, baseResolved, /* isBase */ true);
  }

  for (const dir of [...searchDirs].reverse()) {
    const tbmFiles = listMatchingFiles(dir, /-aip\.tbm$/i).sort((a, b) =>
      basenameOfResolved(b).localeCompare(basenameOfResolved(a)),
    );
    for (const resolved of tbmFiles) {
      applyLayer(result, resolved, /* isBase */ false);
    }
  }

  return result;
}

/** Unique AI profile names in their original (first-seen) casing - for completion display. */
export function collectDisplayAiProfileNames(aiProfilesTable: Map<string, EffectiveAiProfileEntry>): string[] {
  return Array.from(aiProfilesTable.values()).map((e) => e.name);
}

function applyLayer(result: Map<string, EffectiveAiProfileEntry>, resolved: ResolvedFile, isBase: boolean): void {
  let text: string;
  try {
    text = readResolvedFile(resolved).toString("utf8");
  } catch {
    return;
  }

  const parsed = parseTable(text);
  const entries = extractAiProfileEntries(parsed.sections);
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

    const merged: EffectiveAiProfileEntry = existing ?? { name: entry.name, nameLocation: null, allLocations: [], layerSources: [] };
    merged.nameLocation = { resolved, line: entry.nameLine };
    merged.allLocations = [...merged.allLocations, { resolved, line: entry.nameLine }];
    merged.layerSources = [...merged.layerSources, sourceLabel];

    result.set(key, merged);
  }
}
