import { parseTable } from "../parser";
import { extractFireballEntries } from "./fireballEntries";
import {
  resolveFile,
  listMatchingFiles,
  readResolvedFile,
  basenameOfResolved,
  describeResolvedSource,
  ResolvedFile,
} from "../modResolution/resolver";
import { SourceLocation } from "./sourceLocation";

export interface EffectiveFireballEntry {
  name: string;
  nameLocation: SourceLocation | null;
  allLocations: SourceLocation[];
  layerSources: string[];
  /**
   * Whether this entry's identity came from `$Unique ID:` rather than `$Name:`.
   * Load-bearing distinction (live-verified against fireballs.cpp's
   * `fireball_info_lookup()`): a real cross-reference from another table (e.g. ships.tbl's
   * `$Explosion Animations:`) can only ever resolve against a fireball.tbl entry's
   * `unique_id` field - which for a `$Name:`-only entry is auto-generated
   * (`fireball_generate_unique_id()`) and NOT derived from `$Name:` at all. So a
   * `$Name:`-only entry is not meaningfully referenceable and callers doing that kind of
   * cross-reference check should filter to `keyedByUniqueId === true` entries only.
   */
  keyedByUniqueId: boolean;
}

/**
 * Builds the "effective" merged fireball.tbl view, mirroring buildEffectiveAsteroidTable() -
 * same base-.tbl-plus-.tbm-layers merge order, `-fbl.tbm` suffix (confirmed in
 * fireball.ts schema). Entries keyed by either `$Name:` or `$Unique ID:` are merged into
 * the same map, keyed by lowercased identity string - fireball.tbl is confirmed non-XMT
 * (see fso-table-format project memory), so `+nocreate`/`+remove` support at the
 * whole-entry level is honored here on a best-effort basis, same as armor.tbl.
 */
export function buildEffectiveFireballTable(searchDirs: string[]): Map<string, EffectiveFireballEntry> {
  const result = new Map<string, EffectiveFireballEntry>();

  const baseResolved = resolveFile(searchDirs, "data/tables/fireball.tbl");
  if (baseResolved) {
    applyLayer(result, baseResolved, /* isBase */ true);
  }

  for (const dir of [...searchDirs].reverse()) {
    const tbmFiles = listMatchingFiles(dir, /-fbl\.tbm$/i).sort((a, b) =>
      basenameOfResolved(b).localeCompare(basenameOfResolved(a)),
    );
    for (const resolved of tbmFiles) {
      applyLayer(result, resolved, /* isBase */ false);
    }
  }

  return result;
}

/** Unique fireball entry identities in their original (first-seen) casing - for completion display. */
export function collectDisplayFireballNames(fireballTable: Map<string, EffectiveFireballEntry>): string[] {
  return Array.from(fireballTable.values()).map((e) => e.name);
}

/**
 * Identities of only the `$Unique ID:`-keyed entries - the subset actually resolvable
 * via `fireball_info_lookup()` by another table's cross-reference (see
 * EffectiveFireballEntry.keyedByUniqueId doc comment). Use this, not
 * collectDisplayFireballNames(), when validating/completing a real fireball.tbl
 * cross-reference field like ships.tbl's `$Explosion Animations:`.
 */
export function collectUniqueIdFireballNames(fireballTable: Map<string, EffectiveFireballEntry>): string[] {
  return Array.from(fireballTable.values())
    .filter((e) => e.keyedByUniqueId)
    .map((e) => e.name);
}

function applyLayer(result: Map<string, EffectiveFireballEntry>, resolved: ResolvedFile, isBase: boolean): void {
  let text: string;
  try {
    text = readResolvedFile(resolved).toString("utf8");
  } catch {
    return;
  }

  const parsed = parseTable(text);
  const entries = extractFireballEntries(parsed.sections);
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

    const merged: EffectiveFireballEntry =
      existing ?? { name: entry.name, nameLocation: null, allLocations: [], layerSources: [], keyedByUniqueId: false };
    merged.nameLocation = { resolved, line: entry.nameLine };
    merged.allLocations = [...merged.allLocations, { resolved, line: entry.nameLine }];
    merged.layerSources = [...merged.layerSources, sourceLabel];
    merged.keyedByUniqueId = entry.keyedByUniqueId;

    result.set(key, merged);
  }
}
