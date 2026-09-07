import { parseTable } from "../parser";
import { extractShipEntries, ShipSubsystemRef, ShipBankList } from "./shipEntries";
import {
  resolveFile,
  listMatchingFiles,
  readResolvedFile,
  basenameOfResolved,
  describeResolvedSource,
  ResolvedFile,
} from "../modResolution/resolver";

export interface EffectiveShipEntry {
  name: string;
  modelFile: string | null;
  modelFileSource: string | null;
  subsystems: ShipSubsystemRef[];
  subsystemsSource: string | null;
  defaultPrimaryBanks: ShipBankList | null;
  defaultPrimaryBanksSource: string | null;
  defaultSecondaryBanks: ShipBankList | null;
  defaultSecondaryBanksSource: string | null;
  armorType: string | null;
  armorTypeSource: string | null;
  shieldArmorType: string | null;
  shieldArmorTypeSource: string | null;
  /** Every file that touched this entry, in application order (base .tbl first, then .tbm layers lowest-to-highest priority). */
  layerSources: string[];
}

/**
 * Builds the "effective" merged ships.tbl view across the whole active mod's search
 * path, per the fso-table-format/.tbm merge algorithm: the base ships.tbl is read only
 * from the single highest-priority directory that has it; every matching `-shp.tbm`
 * across every directory is then applied, in reverse search-path order (lowest-priority
 * directory first, highest-priority last, so a higher-priority mod's edits win), with
 * .tbm files within the same directory applied in reverse-alphabetical order.
 *
 * Field-level merge fidelity is simplified for v1: a .tbm entry that specifies
 * `$Model File:`/`$Subsystem:`/`$Default PBanks:`/`$Default SBanks:` replaces the prior
 * value wholesale rather than doing a true per-subsystem/per-bank merge, since that's
 * the level of detail extractShipEntries() currently captures. `+nocreate` and
 * `+remove` are honored at the whole-entry level.
 */
export function buildEffectiveShipTable(searchDirs: string[]): Map<string, EffectiveShipEntry> {
  const result = new Map<string, EffectiveShipEntry>();

  const baseResolved = resolveFile(searchDirs, "data/tables/ships.tbl");
  if (baseResolved) {
    applyLayer(result, baseResolved, /* isBase */ true);
  }

  // .tbm layers apply lowest-to-highest priority, i.e. the reverse of searchDirs
  // (which buildSearchPath returns highest-priority first).
  for (const dir of [...searchDirs].reverse()) {
    const tbmFiles = listMatchingFiles(dir, /-shp\.tbm$/i).sort((a, b) =>
      basenameOfResolved(b).localeCompare(basenameOfResolved(a)),
    );
    for (const resolved of tbmFiles) {
      applyLayer(result, resolved, /* isBase */ false);
    }
  }

  return result;
}

function applyLayer(result: Map<string, EffectiveShipEntry>, resolved: ResolvedFile, isBase: boolean): void {
  let text: string;
  try {
    text = readResolvedFile(resolved).toString("utf8");
  } catch {
    return;
  }

  const parsed = parseTable(text);
  const entries = extractShipEntries(parsed.sections);
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

    const merged: EffectiveShipEntry =
      existing ?? {
        name: entry.name,
        modelFile: null,
        modelFileSource: null,
        subsystems: [],
        subsystemsSource: null,
        defaultPrimaryBanks: null,
        defaultPrimaryBanksSource: null,
        defaultSecondaryBanks: null,
        defaultSecondaryBanksSource: null,
        armorType: null,
        armorTypeSource: null,
        shieldArmorType: null,
        shieldArmorTypeSource: null,
        layerSources: [],
      };

    if (entry.modelFile) {
      merged.modelFile = entry.modelFile;
      merged.modelFileSource = sourceLabel;
    }
    if (entry.subsystems.length > 0) {
      merged.subsystems = entry.subsystems;
      merged.subsystemsSource = sourceLabel;
    }
    if (entry.defaultPrimaryBanks) {
      merged.defaultPrimaryBanks = entry.defaultPrimaryBanks;
      merged.defaultPrimaryBanksSource = sourceLabel;
    }
    if (entry.defaultSecondaryBanks) {
      merged.defaultSecondaryBanks = entry.defaultSecondaryBanks;
      merged.defaultSecondaryBanksSource = sourceLabel;
    }
    if (entry.armorType) {
      merged.armorType = entry.armorType;
      merged.armorTypeSource = sourceLabel;
    }
    if (entry.shieldArmorType) {
      merged.shieldArmorType = entry.shieldArmorType;
      merged.shieldArmorTypeSource = sourceLabel;
    }
    merged.layerSources = [...merged.layerSources, sourceLabel];

    result.set(key, merged);
  }
}
