import { TableSection } from "../parser";
import { stripHiddenNamePrefix } from "./nameNormalization";

export interface ShipSubsystemRef {
  line: number;
  /** Full value after "$Subsystem:", e.g. "engine01, 0.0, 5.0" */
  raw: string;
  /** First comma-separated token - the submodel/subsystem name that should match a POF SOBJ/OBJ2 name. */
  name: string;
  /**
   * Per-turret loadout - confirmed against a real Blue Planet bp-shp.tbm that
   * `$Default PBanks:`/`$Default SBanks:` occurring inside a `$Subsystem:` block
   * (turret loadout) is actually the *majority* real-world occurrence (~81% of all
   * bank-list lines in that mod's ships), not an edge case - every one of these needs
   * the same weapon-name cross-referencing as the ship-level fields below.
   */
  defaultPrimaryBanks: ShipBankList | null;
  defaultSecondaryBanks: ShipBankList | null;
}

/** A "$Default PBanks:"/"$Default SBanks:" weapon-name list, one entry per gun/missile bank. */
export interface ShipBankList {
  line: number;
  weaponNames: string[];
}

export interface ShipTextureRef {
  /** Always "$" for the currently-tracked ship texture fields, but kept explicit (rather than hardcoded at display time) in case a future field turns out to use a different sigil. */
  sigil: "$" | "+" | "@";
  field: string;
  line: number;
  value: string;
}

export interface ShipEntryInfo {
  name: string;
  nameLine: number;
  /** From `$POF file:` (confirmed against ship.cpp - NOT `$Model File:`, which is a weapons.tbl-only field name). */
  modelFile: string | null;
  subsystems: ShipSubsystemRef[];
  /**
   * Ship-level only - `$Default PBanks:`/`$Default SBanks:` are also valid inside a
   * `$Subsystem:` block (per-turret loadout, via the same shared parse_weapon_bank()
   * helper - see fso-table-fields-reference), so extraction stops attributing these to
   * the ship once the first `$Subsystem:` line is seen, rather than letting a
   * per-turret occurrence silently overwrite the ship's own value.
   */
  defaultPrimaryBanks: ShipBankList | null;
  defaultSecondaryBanks: ShipBankList | null;
  /**
   * From `$Armor Type:`/`$Shield Armor Type:` (confirmed real armor.tbl cross-references
   * - NOT `+Armor:`, which is a purely cosmetic tech-room display string like "Medium"
   * with no relation to armor.tbl at all). Ship-level only, same `$Subsystem:`-scoping
   * caveat as the bank fields above (subsystems have their own `$Armor Type:` too).
   */
  armorType: string | null;
  armorTypeLine: number | null;
  shieldArmorType: string | null;
  shieldArmorTypeLine: number | null;
  /** From `$Species:` - references a species_defs.tbl `$Species_Name:` entry. Ship-level only, same `$Subsystem:`-scoping caveat as the other cross-referencing fields above (species has no per-subsystem meaning, but scoping stays consistent for simplicity). */
  species: string | null;
  speciesLine: number | null;
  /** From `$AI Class:` - references an ai.tbl `$Name:` entry (e.g. "Rookie", "Insane"). Ship-level only. */
  aiClass: string | null;
  aiClassLine: number | null;
  /** Bitmap/animation-referencing fields, confirmed against ship.cpp's field list. */
  textureRefs: ShipTextureRef[];
  /** Modular-table-only sentinels (see fso-table-format): only relevant when merging .tbm layers. */
  noCreate: boolean;
  remove: boolean;
}

const TEXTURE_FIELDS = new Set([
  "shield_icon",
  "ship_icon",
  "ship_anim",
  "ship_overhead",
  "thruster normal flame",
  "thruster afterburner flame",
  "briefing icon",
  "briefing icon with cargo",
  "briefing wing icon",
  "briefing wing icon with cargo",
]);

/** Extracts per-ship model-file + subsystem-reference info from a parsed ships.tbl/*-shp.tbm. */
export function extractShipEntries(sections: TableSection[]): ShipEntryInfo[] {
  const entries: ShipEntryInfo[] = [];
  let current: ShipEntryInfo | null = null;
  let inSubsystemScope = false;
  let currentSubsystem: ShipSubsystemRef | null = null;

  for (const section of sections) {
    if (section.name.trim().toLowerCase() !== "ship classes") {
      continue;
    }

    for (const field of section.entries) {
      const key = field.key.trim().toLowerCase();

      if (field.sigil === "$" && key === "name") {
        current = {
          name: stripHiddenNamePrefix(field.value.trim()),
          nameLine: field.line,
          modelFile: null,
          subsystems: [],
          defaultPrimaryBanks: null,
          defaultSecondaryBanks: null,
          armorType: null,
          armorTypeLine: null,
          shieldArmorType: null,
          shieldArmorTypeLine: null,
          species: null,
          speciesLine: null,
          aiClass: null,
          aiClassLine: null,
          textureRefs: [],
          noCreate: false,
          remove: false,
        };
        entries.push(current);
        inSubsystemScope = false;
        currentSubsystem = null;
        continue;
      }
      if (!current) {
        continue;
      }

      if (field.sigil === "+") {
        if (key === "nocreate") {
          current.noCreate = true;
        } else if (key === "remove") {
          current.remove = true;
        }
        continue;
      }

      if (key === "subsystem") {
        inSubsystemScope = true;
        const name = field.value.split(",")[0].trim();
        currentSubsystem = { line: field.line, raw: field.value, name, defaultPrimaryBanks: null, defaultSecondaryBanks: null };
        current.subsystems.push(currentSubsystem);
        continue;
      }

      if (TEXTURE_FIELDS.has(key) && field.value.trim()) {
        current.textureRefs.push({ sigil: field.sigil, field: field.key.trim(), line: field.line, value: field.value.trim() });
      }

      if (inSubsystemScope) {
        // $Armor Type: also occurs per-subsystem; once inside a $Subsystem: block, don't
        // let it overwrite the ship-level value captured before the first $Subsystem:
        // line. $Default PBanks:/$Default SBanks: DO get attributed here though - a
        // turret's own bank list, confirmed as the majority real-world occurrence (see
        // ShipSubsystemRef doc comment).
        if (currentSubsystem && key === "default pbanks") {
          currentSubsystem.defaultPrimaryBanks = { line: field.line, weaponNames: splitBankList(field.value) };
        } else if (currentSubsystem && key === "default sbanks") {
          currentSubsystem.defaultSecondaryBanks = { line: field.line, weaponNames: splitBankList(field.value) };
        }
        continue;
      }

      if (key === "pof file") {
        current.modelFile = field.value.trim();
      } else if (key === "default pbanks") {
        current.defaultPrimaryBanks = { line: field.line, weaponNames: splitBankList(field.value) };
      } else if (key === "default sbanks") {
        current.defaultSecondaryBanks = { line: field.line, weaponNames: splitBankList(field.value) };
      } else if (key === "armor type") {
        current.armorType = field.value.trim();
        current.armorTypeLine = field.line;
      } else if (key === "shield armor type") {
        current.shieldArmorType = field.value.trim();
        current.shieldArmorTypeLine = field.line;
      } else if (key === "species") {
        current.species = field.value.trim();
        current.speciesLine = field.line;
      } else if (key === "ai class") {
        current.aiClass = field.value.trim();
        current.aiClassLine = field.line;
      }
    }
  }

  return entries;
}

/**
 * Parses a `( "Name" "Name" ... )` weapon-bank list - confirmed via
 * parse_weapon_bank()'s `stuff_int_list(..., WEAPON_LIST_TYPE)` in ship.cpp: a
 * parenthesized list of quoted weapon names, one per bank. Falls back to a plain
 * comma-split for any table that (unusually) omits the quotes/parens.
 */
function splitBankList(value: string): string[] {
  const quoted = [...value.matchAll(/"([^"]*)"/g)].map((m) => m[1].trim());
  if (quoted.length > 0) {
    return quoted;
  }
  return value
    .replace(/[()]/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** The ship entry whose `$Name:` most recently precedes `line` (entries are in document order). */
export function findCurrentShipEntry(entries: ShipEntryInfo[], line: number): ShipEntryInfo | null {
  let candidate: ShipEntryInfo | null = null;
  for (const entry of entries) {
    if (entry.nameLine <= line) {
      candidate = entry;
    } else {
      break;
    }
  }
  return candidate;
}
