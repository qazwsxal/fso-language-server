import { parseTable } from "../parser";
import { extractSsmEntries } from "./ssmEntries";
import {
  resolveFile,
  listMatchingFiles,
  readResolvedFile,
  basenameOfResolved,
  describeResolvedSource,
  ResolvedFile,
} from "../modResolution/resolver";
import { SourceLocation } from "./sourceLocation";

export interface EffectiveSsmEntry {
  name: string;
  nameLocation: SourceLocation | null;
  allLocations: SourceLocation[];
  layerSources: string[];
  /**
   * The 0-based effective position in FSO's in-memory `Ssm_info` vector - what a bare-
   * integer weapons.tbl `$SSM:` value resolves against directly (`stuff_int_optional()`'s
   * success path in `parse_weapon()`, ground-truthed against weapons.cpp). A genuinely
   * new entry (one that isn't overriding an existing entry via `+nocreate`) appends at the
   * next free index, mirroring `parse_ssm()`'s merge order; an override reuses its
   * target's existing index. Same mechanism as EffectiveFireballEntry.index.
   */
  index: number;
}

/**
 * Builds the "effective" merged ssm.tbl view - the weapons.tbl `$SSM:` cross-reference
 * target. Mirrors buildEffectiveFireballTable()'s index-tracking merge order, `-ssm.tbm`
 * suffix (confirmed against hudartillery.cpp's `parse_modular_table(NOX("*-ssm.tbm"),
 * ...)`). See ssmEntries.ts for why there's no in-file section-header check.
 */
export function buildEffectiveSsmTable(searchDirs: string[]): Map<string, EffectiveSsmEntry> {
  const result = new Map<string, EffectiveSsmEntry>();
  let nextIndex = 0;

  const baseResolved = resolveFile(searchDirs, "data/tables/ssm.tbl");
  if (baseResolved) {
    nextIndex = applyLayer(result, baseResolved, /* isBase */ true, nextIndex);
  }

  for (const dir of [...searchDirs].reverse()) {
    const tbmFiles = listMatchingFiles(dir, /-ssm\.tbm$/i).sort((a, b) =>
      basenameOfResolved(b).localeCompare(basenameOfResolved(a)),
    );
    for (const resolved of tbmFiles) {
      nextIndex = applyLayer(result, resolved, /* isBase */ false, nextIndex);
    }
  }

  return result;
}

/** Unique SSM entry names in their original (first-seen) casing - for completion display. */
export function collectDisplaySsmNames(ssmTable: Map<string, EffectiveSsmEntry>): string[] {
  return Array.from(ssmTable.values()).map((e) => e.name);
}

/**
 * Resolves a single weapons.tbl `$SSM:` value to its ssm.tbl entry. A bare integer
 * resolves against each entry's effective `index`; anything else resolves against each
 * entry's name, case-insensitively - mirroring `parse_weapon()`'s
 * `stuff_int_optional()`-then-string-fallback logic and `ssm_info_lookup()` respectively.
 */
export function resolveSsmReference(ssmTable: Map<string, EffectiveSsmEntry>, token: string): EffectiveSsmEntry | null {
  const trimmed = token.trim();
  if (/^-?\d+$/.test(trimmed)) {
    const idx = Number(trimmed);
    for (const entry of ssmTable.values()) {
      if (entry.index === idx) {
        return entry;
      }
    }
    return null;
  }

  return ssmTable.get(trimmed.toLowerCase()) ?? null;
}

function applyLayer(result: Map<string, EffectiveSsmEntry>, resolved: ResolvedFile, isBase: boolean, nextIndex: number): number {
  let text: string;
  try {
    text = readResolvedFile(resolved).toString("utf8");
  } catch {
    return nextIndex;
  }

  const parsed = parseTable(text);
  const entries = extractSsmEntries(parsed.sections);
  const sourceLabel = describeResolvedSource(resolved);

  for (const entry of entries) {
    const key = entry.name.toLowerCase();

    const existing = result.get(key);
    if (!isBase && !existing && entry.noCreate) {
      continue;
    }

    const index = existing?.index ?? nextIndex;
    if (!existing) {
      nextIndex++;
    }

    const merged: EffectiveSsmEntry = existing ?? { name: entry.name, nameLocation: null, allLocations: [], layerSources: [], index };
    merged.nameLocation = { resolved, line: entry.nameLine };
    merged.allLocations = [...merged.allLocations, { resolved, line: entry.nameLine }];
    merged.layerSources = [...merged.layerSources, sourceLabel];
    merged.index = index;

    result.set(key, merged);
  }

  return nextIndex;
}
