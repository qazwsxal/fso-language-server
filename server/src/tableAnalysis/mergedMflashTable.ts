import { parseTable } from "../parser";
import { extractMflashEntries } from "./mflashEntries";
import {
  resolveFile,
  listMatchingFiles,
  readResolvedFile,
  basenameOfResolved,
  describeResolvedSource,
  ResolvedFile,
} from "../modResolution/resolver";
import { SourceLocation } from "./sourceLocation";

export interface EffectiveMflashEntry {
  name: string;
  nameLocation: SourceLocation | null;
  allLocations: SourceLocation[];
  layerSources: string[];
}

/**
 * Builds the "effective" merged view of mflash.tbl's `#Muzzle flash types` section - the
 * `$Muzzleflash:` cross-reference target. Mirrors buildEffectiveAiClassTable() - same
 * base-.tbl-plus-.tbm-layers merge order, `-mfl.tbm` suffix (confirmed against
 * `muzzleflash.cpp`'s `parse_modular_table(NOX("*-mfl.tbm"), ...)`). See
 * mflashEntries.ts's doc comment for why this always lets a later layer overwrite rather
 * than modeling the real engine's `+override`-gated first-match-wins behavior.
 */
export function buildEffectiveMflashTable(searchDirs: string[]): Map<string, EffectiveMflashEntry> {
  const result = new Map<string, EffectiveMflashEntry>();

  const baseResolved = resolveFile(searchDirs, "data/tables/mflash.tbl");
  if (baseResolved) {
    applyLayer(result, baseResolved);
  }

  for (const dir of [...searchDirs].reverse()) {
    const tbmFiles = listMatchingFiles(dir, /-mfl\.tbm$/i).sort((a, b) =>
      basenameOfResolved(b).localeCompare(basenameOfResolved(a)),
    );
    for (const resolved of tbmFiles) {
      applyLayer(result, resolved);
    }
  }

  return result;
}

/** Unique mflash entry names in their original (first-seen) casing - for completion display. */
export function collectDisplayMflashNames(mflashTable: Map<string, EffectiveMflashEntry>): string[] {
  return Array.from(mflashTable.values()).map((e) => e.name);
}

function applyLayer(result: Map<string, EffectiveMflashEntry>, resolved: ResolvedFile): void {
  let text: string;
  try {
    text = readResolvedFile(resolved).toString("utf8");
  } catch {
    return;
  }

  const parsed = parseTable(text);
  const entries = extractMflashEntries(parsed.sections);
  const sourceLabel = describeResolvedSource(resolved);

  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    const existing = result.get(key);

    const merged: EffectiveMflashEntry = existing ?? { name: entry.name, nameLocation: null, allLocations: [], layerSources: [] };
    merged.nameLocation = { resolved, line: entry.nameLine };
    merged.allLocations = [...merged.allLocations, { resolved, line: entry.nameLine }];
    merged.layerSources = [...merged.layerSources, sourceLabel];

    result.set(key, merged);
  }
}
