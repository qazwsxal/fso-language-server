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
  /** Whether this entry's most recent layer carried a `$Unique ID:` field rather than being `$Name:`-only. */
  keyedByUniqueId: boolean;
  /**
   * The entry's effective `unique_id` - either the explicit `$Unique ID:` value, or (for
   * a `$Name:`-only entry) the same auto-generated id the real engine would assign via
   * `fireball_generate_unique_id()`: a special name for each of the 6 default
   * `fireball.tbl` slots, else `"Custom Fireball " + (index - 6 + 1)`. Ground-truthed
   * against `fireballs.cpp`. This is what a *quoted-string* `$Explosion Animations:` list
   * item resolves against (`fireball_info_lookup()`).
   */
  uniqueId: string;
  /**
   * The 0-based effective position in FSO's in-memory `Fireball_info` vector - what an
   * *unquoted* `$Explosion Animations:` list item resolves against directly
   * (`stuff_fireball_index_list()` -> `stuff_int_list()`'s plain `stuff_int()` path for a
   * bare integer, ground-truthed against parselo.cpp). A genuinely new entry (one that
   * isn't overriding an existing entry) appends at the next free index, mirroring
   * `parse_fireball_tbl()`'s merge order; an override reuses its target's existing index.
   */
  index: number;
}

const NUM_DEFAULT_FIREBALLS = 6;

/** Mirrors `fireball_generate_unique_id()` for a `$Name:`-only entry at the given effective index. */
function autoUniqueId(index: number): string {
  switch (index) {
    case 0:
      return "Medium Explosion";
    case 1:
      return "Warp Effect";
    case 2:
      return "Knossos Effect";
    case 3:
      return "Asteroid Explosion";
    case 4:
      return "Large Explosion 1";
    case 5:
      return "Large Explosion 2";
    default:
      return `Custom Fireball ${index - NUM_DEFAULT_FIREBALLS + 1}`;
  }
}

/**
 * Builds the "effective" merged fireball.tbl view, mirroring buildEffectiveAsteroidTable() -
 * same base-.tbl-plus-.tbm-layers merge order, `-fbl.tbm` suffix (confirmed in
 * fireball.ts schema). Entries are keyed by `$Name:` (or, when a layer's `$Unique ID:`
 * matches a previously-seen entry's effective `uniqueId`, by that entry's existing key -
 * mirroring `parse_fireball_tbl()`'s "override by matching unique ID" path) - fireball.tbl
 * is confirmed non-XMT (see fso-table-format project memory), so `+nocreate`/`+remove`
 * support at the whole-entry level is honored here on a best-effort basis, same as
 * armor.tbl. The `+Explosion_Medium`/`+Custom_Fireball N`-style positional-override
 * sentinels are not modeled - too rare in practice for the added complexity.
 */
export function buildEffectiveFireballTable(searchDirs: string[]): Map<string, EffectiveFireballEntry> {
  const result = new Map<string, EffectiveFireballEntry>();
  let nextIndex = 0;

  const baseResolved = resolveFile(searchDirs, "data/tables/fireball.tbl");
  if (baseResolved) {
    nextIndex = applyLayer(result, baseResolved, /* isBase */ true, nextIndex);
  }

  for (const dir of [...searchDirs].reverse()) {
    const tbmFiles = listMatchingFiles(dir, /-fbl\.tbm$/i).sort((a, b) =>
      basenameOfResolved(b).localeCompare(basenameOfResolved(a)),
    );
    for (const resolved of tbmFiles) {
      nextIndex = applyLayer(result, resolved, /* isBase */ false, nextIndex);
    }
  }

  return result;
}

/** Unique fireball entry identities in their original (first-seen) casing - for completion display. */
export function collectDisplayFireballNames(fireballTable: Map<string, EffectiveFireballEntry>): string[] {
  return Array.from(fireballTable.values()).map((e) => e.name);
}

/** Effective `unique_id` (explicit or auto-generated) of every entry - for completion of a quoted-string `$Explosion Animations:` item. */
export function collectFireballUniqueIds(fireballTable: Map<string, EffectiveFireballEntry>): string[] {
  return Array.from(fireballTable.values()).map((e) => e.uniqueId);
}

/**
 * Resolves a single `$Explosion Animations:`-style list token to its fireball.tbl entry.
 * A bare integer resolves against each entry's effective `index`; anything else (a
 * quoted string, per the table grammar) resolves against each entry's effective
 * `uniqueId`, case-insensitively - mirroring `stuff_fireball_index_list()`'s two
 * resolution paths (ground-truthed against parselo.cpp's `FIREBALL_INFO_TYPE` case).
 */
export function resolveFireballReference(
  fireballTable: Map<string, EffectiveFireballEntry>,
  token: string,
): EffectiveFireballEntry | null {
  const trimmed = token.trim();
  if (/^-?\d+$/.test(trimmed)) {
    const idx = Number(trimmed);
    for (const entry of fireballTable.values()) {
      if (entry.index === idx) {
        return entry;
      }
    }
    return null;
  }

  const lower = trimmed.toLowerCase();
  for (const entry of fireballTable.values()) {
    if (entry.uniqueId.toLowerCase() === lower) {
      return entry;
    }
  }
  return null;
}

function applyLayer(
  result: Map<string, EffectiveFireballEntry>,
  resolved: ResolvedFile,
  isBase: boolean,
  nextIndex: number,
): number {
  let text: string;
  try {
    text = readResolvedFile(resolved).toString("utf8");
  } catch {
    return nextIndex;
  }

  const parsed = parseTable(text);
  const entries = extractFireballEntries(parsed.sections);
  const sourceLabel = describeResolvedSource(resolved);

  // uniqueId (lowercased) -> map key, so a layer's explicit `$Unique ID:` override finds
  // its target even when this layer's `$Name:` differs from the original entry's.
  const uniqueIdIndex = new Map<string, string>();
  for (const [mapKey, entry] of result) {
    uniqueIdIndex.set(entry.uniqueId.toLowerCase(), mapKey);
  }

  for (const entry of entries) {
    const nameKey = entry.name.toLowerCase();
    const overrideKey = entry.uniqueId ? uniqueIdIndex.get(entry.uniqueId.toLowerCase()) : undefined;
    const key = overrideKey ?? nameKey;

    if (!isBase && entry.remove) {
      result.delete(key);
      continue;
    }

    const existing = result.get(key);
    if (!isBase && !existing && entry.noCreate) {
      continue;
    }

    const index = existing?.index ?? nextIndex;
    if (!existing) {
      nextIndex++;
    }
    const uniqueId = entry.uniqueId ?? existing?.uniqueId ?? autoUniqueId(index);

    const merged: EffectiveFireballEntry =
      existing ?? { name: entry.name, nameLocation: null, allLocations: [], layerSources: [], keyedByUniqueId: false, uniqueId, index };
    merged.nameLocation = { resolved, line: entry.nameLine };
    merged.allLocations = [...merged.allLocations, { resolved, line: entry.nameLine }];
    merged.layerSources = [...merged.layerSources, sourceLabel];
    merged.keyedByUniqueId = entry.keyedByUniqueId;
    merged.name = entry.name;
    merged.uniqueId = uniqueId;
    merged.index = index;

    result.set(key, merged);
  }

  return nextIndex;
}
