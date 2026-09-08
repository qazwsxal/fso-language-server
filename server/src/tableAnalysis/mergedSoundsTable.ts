import { parseTable } from "../parser";
import { extractSoundEntries, SoundSectionKind } from "./soundsEntries";
import {
  resolveFile,
  listMatchingFiles,
  readResolvedFile,
  basenameOfResolved,
  describeResolvedSource,
  ResolvedFile,
} from "../modResolution/resolver";
import { SourceLocation } from "./sourceLocation";

export interface EffectiveSoundEntry {
  kind: SoundSectionKind;
  name: string;
  nameLocation: SourceLocation | null;
  allLocations: SourceLocation[];
  layerSources: string[];
}

/** Composite key: a sound's identity string only has meaning within its own section kind (see soundsEntries.ts). */
export function mapKey(kind: SoundSectionKind, name: string): string {
  return `${kind}::${name.toLowerCase()}`;
}

/**
 * Unique entry identities of one section kind, in their original (first-seen) casing -
 * for completion display and cross-reference validation scoped to that section. In
 * practice every real ships.tbl/weapons.tbl sound-referencing field resolves against
 * the `"game"` kind only (confirmed exhaustively - see [[fso-gamesnd-lookup]] project
 * memory), but this stays kind-parameterized rather than hardcoded to `"game"` since the
 * merged table itself doesn't assume that.
 */
export function collectDisplayNamesForKind(soundsTable: Map<string, EffectiveSoundEntry>, kind: SoundSectionKind): string[] {
  return Array.from(soundsTable.values())
    .filter((e) => e.kind === kind)
    .map((e) => e.name);
}

/**
 * Builds the "effective" merged sounds.tbl view, mirroring buildEffectiveAsteroidTable() -
 * same base-.tbl-plus-.tbm-layers merge order, `-snd.tbm` suffix (confirmed in
 * sounds.ts schema). Unlike the single-section tables, entries are keyed by
 * `kind::name` since the same index string can recur across sounds.tbl's independent
 * sections with unrelated meanings.
 */
export function buildEffectiveSoundsTable(searchDirs: string[]): Map<string, EffectiveSoundEntry> {
  const result = new Map<string, EffectiveSoundEntry>();

  const baseResolved = resolveFile(searchDirs, "data/tables/sounds.tbl");
  if (baseResolved) {
    applyLayer(result, baseResolved, /* isBase */ true);
  }

  for (const dir of [...searchDirs].reverse()) {
    const tbmFiles = listMatchingFiles(dir, /-snd\.tbm$/i).sort((a, b) =>
      basenameOfResolved(b).localeCompare(basenameOfResolved(a)),
    );
    for (const resolved of tbmFiles) {
      applyLayer(result, resolved, /* isBase */ false);
    }
  }

  return result;
}

function applyLayer(result: Map<string, EffectiveSoundEntry>, resolved: ResolvedFile, isBase: boolean): void {
  let text: string;
  try {
    text = readResolvedFile(resolved).toString("utf8");
  } catch {
    return;
  }

  const parsed = parseTable(text);
  const entries = extractSoundEntries(parsed.sections);
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

    const merged: EffectiveSoundEntry =
      existing ?? { kind: entry.kind, name: entry.name, nameLocation: null, allLocations: [], layerSources: [] };
    merged.nameLocation = { resolved, line: entry.nameLine };
    merged.allLocations = [...merged.allLocations, { resolved, line: entry.nameLine }];
    merged.layerSources = [...merged.layerSources, sourceLabel];

    result.set(key, merged);
  }
}
