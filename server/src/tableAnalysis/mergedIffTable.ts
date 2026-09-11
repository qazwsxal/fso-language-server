import { parseTable } from "../parser";
import { extractIffEntries } from "./iffEntries";
import {
  resolveFile,
  listMatchingFiles,
  readResolvedFile,
  basenameOfResolved,
  describeResolvedSource,
  ResolvedFile,
} from "../modResolution/resolver";
import { SourceLocation } from "./sourceLocation";
import { BUILTIN_IFF_DEFS_TBL } from "./builtinTableDefaults";

export interface EffectiveIffEntry {
  name: string;
  nameLocation: SourceLocation | null;
  /** Every location (base .tbl + every .tbm layer, in application order) where this IFF's `$IFF Name:` was touched - for "cycle through every definition" go-to-definition. */
  allLocations: SourceLocation[];
  layerSources: string[];
}

/**
 * Builds the "effective" merged iff_defs.tbl view, mirroring buildEffectiveSpeciesTable()
 * - same base-.tbl-plus-.tbm-layers merge order, `-iff.tbm` suffix (confirmed in
 * iffDefs.ts schema).
 */
export function buildEffectiveIffTable(searchDirs: string[]): Map<string, EffectiveIffEntry> {
  const result = new Map<string, EffectiveIffEntry>();

  const baseResolved = resolveFile(searchDirs, "data/tables/iff_defs.tbl");
  if (baseResolved) {
    applyLayer(result, baseResolved, /* isBase */ true);
  } else {
    // No real iff_defs.tbl anywhere on the search path - see builtinTableDefaults.ts:
    // FSO itself falls back to a compiled-in default here rather than having no IFFs.
    applyBuiltinDefaultLayer(result, BUILTIN_IFF_DEFS_TBL);
  }

  for (const dir of [...searchDirs].reverse()) {
    const tbmFiles = listMatchingFiles(dir, /-iff\.tbm$/i).sort((a, b) =>
      basenameOfResolved(b).localeCompare(basenameOfResolved(a)),
    );
    for (const resolved of tbmFiles) {
      applyLayer(result, resolved, /* isBase */ false);
    }
  }

  return result;
}

/** Unique IFF names in their original (first-seen) casing - for completion display. */
export function collectDisplayIffNames(iffTable: Map<string, EffectiveIffEntry>): string[] {
  return Array.from(iffTable.values()).map((e) => e.name);
}

/** Same effect as applyLayer() for the base layer, but for FSO's compiled-in default text (see mergedSpeciesTable.ts's applyBuiltinDefaultLayer() for the full rationale). */
function applyBuiltinDefaultLayer(result: Map<string, EffectiveIffEntry>, text: string): void {
  const entries = extractIffEntries(parseTable(text).sections);
  for (const entry of entries) {
    result.set(entry.name.toLowerCase(), {
      name: entry.name,
      nameLocation: null,
      allLocations: [],
      layerSources: ["(FSO built-in default)"],
    });
  }
}

function applyLayer(result: Map<string, EffectiveIffEntry>, resolved: ResolvedFile, isBase: boolean): void {
  let text: string;
  try {
    text = readResolvedFile(resolved).toString("utf8");
  } catch {
    return;
  }

  const parsed = parseTable(text);
  const entries = extractIffEntries(parsed.sections);
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

    const merged: EffectiveIffEntry =
      existing ?? { name: entry.name, nameLocation: null, allLocations: [], layerSources: [] };
    merged.nameLocation = { resolved, line: entry.nameLine };
    merged.allLocations = [...merged.allLocations, { resolved, line: entry.nameLine }];
    merged.layerSources = [...merged.layerSources, sourceLabel];

    result.set(key, merged);
  }
}
