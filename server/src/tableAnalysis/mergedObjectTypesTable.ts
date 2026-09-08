import { parseTable } from "../parser";
import { extractObjectTypeEntries, ObjectTypeSectionKind } from "./objectTypesEntries";
import {
  resolveFile,
  listMatchingFiles,
  readResolvedFile,
  basenameOfResolved,
  describeResolvedSource,
  ResolvedFile,
} from "../modResolution/resolver";
import { SourceLocation } from "./sourceLocation";

export interface EffectiveObjectTypeEntry {
  kind: ObjectTypeSectionKind;
  name: string;
  nameLocation: SourceLocation | null;
  allLocations: SourceLocation[];
  layerSources: string[];
}

export function mapKey(kind: ObjectTypeSectionKind, name: string): string {
  return `${kind}::${name.toLowerCase()}`;
}

/** Unique entry identities of one section kind, in their original (first-seen) casing - for completion display and cross-reference validation scoped to that section. */
export function collectDisplayNamesForKind(
  objectTypesTable: Map<string, EffectiveObjectTypeEntry>,
  kind: ObjectTypeSectionKind,
): string[] {
  return Array.from(objectTypesTable.values())
    .filter((e) => e.kind === kind)
    .map((e) => e.name);
}

/**
 * Builds the "effective" merged objecttypes.tbl view, mirroring buildEffectiveSoundsTable() -
 * same base-.tbl-plus-.tbm-layers merge order, `-obt.tbm` suffix (confirmed in
 * objectTypes.ts schema), entries keyed by `kind::name` since the three sections are
 * independent namespaces. objecttypes.tbl is one of FSO's hardcoded-fallback tables (see
 * fso-table-format project memory) - a missing base file on disk just means no base
 * layer applies here, mirroring the real engine's built-in-default fallback.
 */
export function buildEffectiveObjectTypesTable(searchDirs: string[]): Map<string, EffectiveObjectTypeEntry> {
  const result = new Map<string, EffectiveObjectTypeEntry>();

  const baseResolved = resolveFile(searchDirs, "data/tables/objecttypes.tbl");
  if (baseResolved) {
    applyLayer(result, baseResolved, /* isBase */ true);
  }

  for (const dir of [...searchDirs].reverse()) {
    const tbmFiles = listMatchingFiles(dir, /-obt\.tbm$/i).sort((a, b) =>
      basenameOfResolved(b).localeCompare(basenameOfResolved(a)),
    );
    for (const resolved of tbmFiles) {
      applyLayer(result, resolved, /* isBase */ false);
    }
  }

  return result;
}

function applyLayer(result: Map<string, EffectiveObjectTypeEntry>, resolved: ResolvedFile, isBase: boolean): void {
  let text: string;
  try {
    text = readResolvedFile(resolved).toString("utf8");
  } catch {
    return;
  }

  const parsed = parseTable(text);
  const entries = extractObjectTypeEntries(parsed.sections);
  const sourceLabel = describeResolvedSource(resolved);

  for (const entry of entries) {
    const key = mapKey(entry.kind, entry.name);

    if (!isBase && entry.remove) {
      result.delete(key);
      continue;
    }

    const existing = result.get(key);
    if (!isBase && !existing && entry.noCreate) {
      continue;
    }

    const merged: EffectiveObjectTypeEntry =
      existing ?? { kind: entry.kind, name: entry.name, nameLocation: null, allLocations: [], layerSources: [] };
    merged.nameLocation = { resolved, line: entry.nameLine };
    merged.allLocations = [...merged.allLocations, { resolved, line: entry.nameLine }];
    merged.layerSources = [...merged.layerSources, sourceLabel];

    result.set(key, merged);
  }
}
