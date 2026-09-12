import { parseTable } from "../parser";
import { extractShipTemplateEntries } from "./shipEntries";
import {
  resolveFile,
  listMatchingFiles,
  readResolvedFile,
  basenameOfResolved,
  describeResolvedSource,
  ResolvedFile,
} from "../modResolution/resolver";
import { SourceLocation } from "./sourceLocation";

export interface EffectiveShipTemplateEntry {
  name: string;
  nameLocation: SourceLocation | null;
  /** Every location (base .tbl + every .tbm layer, in application order) where this template's `$Template:` was touched - for "cycle through every definition" go-to-definition. */
  allLocations: SourceLocation[];
  useTemplate: string | null;
  useTemplateSource: string | null;
  layerSources: string[];
}

/** Unique ship-template names in their original (first-seen) casing - for completion display, where lowercasing would look wrong. */
export function collectDisplayShipTemplateNames(templateTable: Map<string, EffectiveShipTemplateEntry>): string[] {
  return Array.from(templateTable.values()).map((e) => e.name);
}

/**
 * Builds the "effective" merged view of every `#Ship Templates` entry across the whole
 * active mod's search path. Templates live in the SAME files as ship classes
 * (ships.tbl/*-shp.tbm, just a different section), so this reads exactly the same base-
 * file-plus-`-shp.tbm`-layers set as buildEffectiveShipTable() - just extracted via
 * extractShipTemplateEntries() instead. No noCreate/remove handling: ship.cpp explicitly
 * ignores `+nocreate` on a template (with a warning) and templates have no `+remove`
 * sentinel at all, so every layer's entries simply overwrite by name.
 */
export function buildEffectiveShipTemplateTable(searchDirs: string[]): Map<string, EffectiveShipTemplateEntry> {
  const result = new Map<string, EffectiveShipTemplateEntry>();

  const baseResolved = resolveFile(searchDirs, "data/tables/ships.tbl");
  if (baseResolved) {
    applyLayer(result, baseResolved);
  }

  for (const dir of [...searchDirs].reverse()) {
    const tbmFiles = listMatchingFiles(dir, /-shp\.tbm$/i).sort((a, b) =>
      basenameOfResolved(b).localeCompare(basenameOfResolved(a)),
    );
    for (const resolved of tbmFiles) {
      applyLayer(result, resolved);
    }
  }

  return result;
}

function applyLayer(result: Map<string, EffectiveShipTemplateEntry>, resolved: ResolvedFile): void {
  let text: string;
  try {
    text = readResolvedFile(resolved).toString("utf8");
  } catch {
    return;
  }

  const parsed = parseTable(text);
  const entries = extractShipTemplateEntries(parsed.sections);
  const sourceLabel = describeResolvedSource(resolved);

  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    const existing = result.get(key);

    const merged: EffectiveShipTemplateEntry =
      existing ?? {
        name: entry.name,
        nameLocation: null,
        allLocations: [],
        useTemplate: null,
        useTemplateSource: null,
        layerSources: [],
      };

    merged.nameLocation = { resolved, line: entry.nameLine };
    merged.allLocations = [...merged.allLocations, { resolved, line: entry.nameLine }];
    if (entry.useTemplate) {
      merged.useTemplate = entry.useTemplate;
      merged.useTemplateSource = sourceLabel;
    }
    merged.layerSources = [...merged.layerSources, sourceLabel];

    result.set(key, merged);
  }
}
