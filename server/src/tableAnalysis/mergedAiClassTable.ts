import { parseTable } from "../parser";
import { extractAiClassEntries } from "./aiClassEntries";
import {
  resolveFile,
  listMatchingFiles,
  readResolvedFile,
  basenameOfResolved,
  describeResolvedSource,
  ResolvedFile,
} from "../modResolution/resolver";
import { SourceLocation } from "./sourceLocation";

export interface EffectiveAiClassEntry {
  name: string;
  nameLocation: SourceLocation | null;
  /** Every location (base .tbl + every .tbm layer, in application order) where this AI class' `$Name:` was touched - for "cycle through every definition" go-to-definition. */
  allLocations: SourceLocation[];
  layerSources: string[];
}

/**
 * Builds the "effective" merged ai.tbl view, mirroring buildEffectiveSpeciesTable() -
 * same base-.tbl-plus-.tbm-layers merge order, `-ai.tbm` suffix (confirmed in
 * aiClasses.ts schema).
 */
export function buildEffectiveAiClassTable(searchDirs: string[]): Map<string, EffectiveAiClassEntry> {
  const result = new Map<string, EffectiveAiClassEntry>();

  const baseResolved = resolveFile(searchDirs, "data/tables/ai.tbl");
  if (baseResolved) {
    applyLayer(result, baseResolved, /* isBase */ true);
  }

  for (const dir of [...searchDirs].reverse()) {
    const tbmFiles = listMatchingFiles(dir, /-ai\.tbm$/i).sort((a, b) =>
      basenameOfResolved(b).localeCompare(basenameOfResolved(a)),
    );
    for (const resolved of tbmFiles) {
      applyLayer(result, resolved, /* isBase */ false);
    }
  }

  return result;
}

/** Unique AI class names in their original (first-seen) casing - for completion display. */
export function collectDisplayAiClassNames(aiClassTable: Map<string, EffectiveAiClassEntry>): string[] {
  return Array.from(aiClassTable.values()).map((e) => e.name);
}

function applyLayer(result: Map<string, EffectiveAiClassEntry>, resolved: ResolvedFile, isBase: boolean): void {
  let text: string;
  try {
    text = readResolvedFile(resolved).toString("utf8");
  } catch {
    return;
  }

  const parsed = parseTable(text);
  const entries = extractAiClassEntries(parsed.sections);
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

    const merged: EffectiveAiClassEntry =
      existing ?? { name: entry.name, nameLocation: null, allLocations: [], layerSources: [] };
    merged.nameLocation = { resolved, line: entry.nameLine };
    merged.allLocations = [...merged.allLocations, { resolved, line: entry.nameLine }];
    merged.layerSources = [...merged.layerSources, sourceLabel];

    result.set(key, merged);
  }
}
