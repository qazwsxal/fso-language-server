import { parseTable } from "../parser";
import { extractColorsEntries } from "./colorsEntries";
import {
  resolveFile,
  listMatchingFiles,
  readResolvedFile,
  basenameOfResolved,
  describeResolvedSource,
  ResolvedFile,
} from "../modResolution/resolver";
import { SourceLocation } from "./sourceLocation";

export interface EffectiveTeamColorEntry {
  name: string;
  nameLocation: SourceLocation | null;
  allLocations: SourceLocation[];
  layerSources: string[];
}

/**
 * Builds the "effective" merged view of colors.tbl's `#Team Colors` section - the
 * `$Default Team:` cross-reference target (see ship.cpp: `Team_Colors.find(name)`).
 * Mirrors buildEffectiveAiClassTable() - same base-.tbl-plus-.tbm-layers merge order,
 * `-clr.tbm` suffix (confirmed against `alphacolors.cpp`'s `parse_modular_table(NOX("*-
 * clr.tbm"), ...)`). No `+nocreate`/`+remove` handling - see colorsEntries.ts's doc
 * comment; every layer's `$Team Name:` entries simply overwrite by name.
 */
export function buildEffectiveTeamColorTable(searchDirs: string[]): Map<string, EffectiveTeamColorEntry> {
  const result = new Map<string, EffectiveTeamColorEntry>();

  const baseResolved = resolveFile(searchDirs, "data/tables/colors.tbl");
  if (baseResolved) {
    applyLayer(result, baseResolved);
  }

  for (const dir of [...searchDirs].reverse()) {
    const tbmFiles = listMatchingFiles(dir, /-clr\.tbm$/i).sort((a, b) =>
      basenameOfResolved(b).localeCompare(basenameOfResolved(a)),
    );
    for (const resolved of tbmFiles) {
      applyLayer(result, resolved);
    }
  }

  return result;
}

/** Unique team color names in their original (first-seen) casing - for completion display. */
export function collectDisplayTeamColorNames(colorsTable: Map<string, EffectiveTeamColorEntry>): string[] {
  return Array.from(colorsTable.values()).map((e) => e.name);
}

function applyLayer(result: Map<string, EffectiveTeamColorEntry>, resolved: ResolvedFile): void {
  let text: string;
  try {
    text = readResolvedFile(resolved).toString("utf8");
  } catch {
    return;
  }

  const parsed = parseTable(text);
  const entries = extractColorsEntries(parsed.sections);
  const sourceLabel = describeResolvedSource(resolved);

  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    const existing = result.get(key);

    const merged: EffectiveTeamColorEntry = existing ?? { name: entry.name, nameLocation: null, allLocations: [], layerSources: [] };
    merged.nameLocation = { resolved, line: entry.nameLine };
    merged.allLocations = [...merged.allLocations, { resolved, line: entry.nameLine }];
    merged.layerSources = [...merged.layerSources, sourceLabel];

    result.set(key, merged);
  }
}
