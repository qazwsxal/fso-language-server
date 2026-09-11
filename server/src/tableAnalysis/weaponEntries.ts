import { TableSection } from "../parser";
import { stripHiddenNamePrefix } from "./nameNormalization";

export interface WeaponTextureRef {
  sigil: "$" | "+" | "@";
  field: string;
  line: number;
  value: string;
}

/** A `$substitute:` entry (repeatable, ammo-depletion/barrel-shift weapon swap) - `name` is either another weapons.tbl weapon name or the literal sentinel `"none"` (confirmed against weapons.cpp: `stricmp("none", ...)` is checked explicitly before the name is resolved). */
export interface WeaponSubstituteRef {
  name: string;
  line: number;
}

/** What table a WeaponNameListRef's names should be checked against. */
export type WeaponNameListKind = "ship-type" | "ship-class" | "species" | "iff";

/**
 * A `+`-sigil, parenthesized-name-list field nested inside `$Homing:` (lock
 * restrictions) or `$Proximity Radius:`/`$MineInfo:` (detonation filters) - confirmed
 * against weapons.cpp: 8 distinct fields across the two blocks, sharing the same 4
 * target-table categories as weapons.tbl's `ship_restrict_strings`/`Pending_proximity_*`
 * mechanism (`LockRestrictionType::TYPE/CLASS/SPECIES/IFF`). Matched by key alone
 * regardless of the enclosing block, same rationale as WeaponEntryInfo.soundRefs - this
 * flat extractor has no general block-scope tracking, and none of these 8 field names
 * collide with anything else in weapons.cpp.
 */
export interface WeaponNameListRef {
  field: string;
  kind: WeaponNameListKind;
  line: number;
  names: string[];
}

export interface WeaponEntryInfo {
  name: string;
  nameLine: number;
  /** Only meaningful for missile/bomb-type weapons - primaries (lasers) typically have no model. Field is `$Model file:` (confirmed against weapons.cpp) - distinct from ships.tbl's `$POF file:`. */
  modelFile: string | null;
  modelFileLine: number | null;
  /** The separate POF shown in the tech room / weapon database, independent of `$Model file:` (confirmed against weapons.cpp's `$Tech Model:` field). */
  techModel: string | null;
  techModelLine: number | null;
  /** An alternate POF substituted for `$Model file:` when the weapon is viewed externally (e.g. mounted on a ship in the external/cockpit view), per weapons.cpp's `$External Model File:` field. */
  externalModelFile: string | null;
  externalModelFileLine: number | null;
  /** References a damage-type string used in one or more armor.tbl `$Damage Type:` entries. */
  damageType: string | null;
  damageTypeLine: number | null;
  /**
   * From the weapon-level `$Armor Type:` (confirmed against weapons.cpp) - the weapon's
   * OWN armor type (used e.g. for damage this weapon takes from flak/collisions),
   * distinct from `$Damage Type:` above (the damage type this weapon INFLICTS) - both
   * are real, separate armor.tbl cross-references.
   */
  armorType: string | null;
  armorTypeLine: number | null;
  /** From `$Muzzleflash:` (confirmed against weapons.cpp: `mflash_lookup()`) - references an mflash.tbl entry (the legacy table-driven muzzle flash system - distinct from the newer, table-free `$Muzzle Effect:` particle-effect field). */
  muzzleflash: string | null;
  muzzleflashLine: number | null;
  /** From `$SSM:` (confirmed against weapons.cpp/hudartillery.cpp: resolved either as a bare 0-based `Ssm_info` index, or - if that fails - as a name looked up via `ssm_info_lookup()`) - references an ssm.tbl entry. */
  ssmClass: string | null;
  ssmClassLine: number | null;
  /** Bitmap/animation-referencing fields, confirmed against weapons.cpp's field list and a real weapons.tbl. */
  textureRefs: WeaponTextureRef[];
  /**
   * Sound-referencing fields - confirmed (live-verified against weapons.cpp/gamesnd.cpp,
   * see [[fso-gamesnd-lookup]] project memory) that every one of these resolves via
   * `parse_game_sound()` against sounds.tbl's Game Sounds section only. Matched by key
   * alone regardless of sigil: `$Shockwave Sound:`/`+Shockwave Sound:` are the same
   * field name used for the main vs. "dinky" shockwave (two call sites, same
   * `parse_shockwave_info()` function, `pre_char` = `"$"`/`"+"`).
   */
  soundRefs: WeaponTextureRef[];
  /**
   * Every other top-level `$Field:` this entry sets that isn't one of the dedicated,
   * specially-handled fields above (or a texture/sound field) - same generic catch-all
   * as ShipEntryInfo.miscFieldRefs, and the same `$`-sigil-only scope boundary applies
   * (weapons.tbl has no block-scope tracking at all, so a `+`/`@`-sigil field can't be
   * reliably distinguished from a nested sub-field of e.g. `$BeamInfo:`/`$Homing:`).
   */
  miscFieldRefs: WeaponTextureRef[];
  /** Every `$substitute:` entry (repeatable) - see WeaponSubstituteRef. */
  substituteRefs: WeaponSubstituteRef[];
  /** Every homing-restriction/proximity-filter name-list field - see WeaponNameListRef. */
  nameListRefs: WeaponNameListRef[];
  /**
   * Every `+Armor Type:` inside a repeatable `$Conditional Impact:` block (confirmed
   * against weapons.cpp) - a per-condition armor.tbl check, separate from the top-level
   * `armorType` above. Reuses WeaponTextureRef's shape since the "does this name exist in
   * some index" cross-check is identical in form to a texture/sound reference, just
   * against armor.tbl.
   */
  conditionalImpactArmorRefs: WeaponTextureRef[];
  /** Modular-table-only sentinels (see fso-table-format): only relevant when merging .tbm layers. */
  noCreate: boolean;
  remove: boolean;
}

/** Top-level `$Field:` texture references. */
const DOLLAR_TEXTURE_FIELDS = new Set(["hud image", "icon", "anim"]);
/** `+Subfield:` texture references. */
const PLUS_TEXTURE_FIELDS = new Set(["tech anim"]);
/**
 * `@Field:` texture references - `@` is a real third sigil confirmed in a real
 * weapons.tbl (the laser-visual cluster: `@Laser Bitmap:`, `@Laser Glow:`, plus
 * non-texture siblings `@Laser Color:`/`@Laser Color2:`/`@Laser Length:`/`@Laser Head
 * Radius:`/`@Laser Tail Radius:` which aren't texture fields at all). An earlier
 * mechanical extraction from weapons.cpp misread this as "$Laser Bitmap: (uses @
 * prefix on the value)" - it's actually the field's own sigil, not a value prefix.
 */
const AT_TEXTURE_FIELDS = new Set(["laser bitmap", "laser glow"]);

/** Every weapons.tbl field confirmed (see [[fso-gamesnd-lookup]] project memory) to resolve a sound name via `parse_game_sound()`, matched by key regardless of sigil. */
const SOUND_FIELDS = new Set([
  "prelaunchsnd",
  "launchsnd",
  "cockpitlaunchsnd",
  "impactsnd",
  "disarmed impactsnd",
  "shield impactsnd",
  "flybysnd",
  "ambientsnd",
  "startfiringsnd",
  "loopfiringsnd",
  "linkedloopfiringsnd",
  "endfiringsnd",
  "trackingsnd",
  "lockedsnd",
  "inflightsnd",
  "beamsound",
  "warmupsound",
  "warmdownsound",
  "shockwave sound",
]);

/**
 * Every weapon-level `$Field:` key with dedicated, specially-handled extraction above -
 * excluded from the generic `miscFieldRefs` catch-all so a field doesn't show up twice.
 */
const HANDLED_TOP_LEVEL_KEYS = new Set([
  "model file",
  "tech model",
  "external model file",
  "damage type",
  "armor type",
  "muzzleflash",
  "ssm",
  "substitute",
  ...DOLLAR_TEXTURE_FIELDS,
  ...SOUND_FIELDS,
]);

/** The 8 `+`-sigil name-list fields (see WeaponNameListRef's doc comment), keyed by their lowercased field name. */
const NAME_LIST_FIELDS = new Map<string, WeaponNameListKind>([
  ["ship types", "ship-type"],
  ["ship classes", "ship-class"],
  ["species", "species"],
  ["iffs", "iff"],
  ["proximity type", "ship-type"],
  ["proximity class", "ship-class"],
  ["proximity species", "species"],
  ["proximity iff", "iff"],
]);

/**
 * Parses a `( "Name" "Name" ... )`-style parenthesized name list - same convention as
 * ships.tbl's splitNameList() (both fields go through FSO's generic
 * `stuff_string_list()`), duplicated locally rather than imported so this module doesn't
 * take a dependency on shipEntries.ts for one small helper.
 */
function splitNameList(value: string): string[] {
  const quoted = [...value.matchAll(/"([^"]*)"/g)].map((m) => m[1].trim());
  if (quoted.length > 0) {
    return quoted;
  }
  return value
    .replace(/[()]/g, "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Extracts per-weapon model-file info from a parsed weapons.tbl/*-wep.tbm. */
export function extractWeaponEntries(sections: TableSection[]): WeaponEntryInfo[] {
  const entries: WeaponEntryInfo[] = [];
  let current: WeaponEntryInfo | null = null;

  for (const section of sections) {
    const sectionName = section.name.trim().toLowerCase();
    if (sectionName !== "primary weapons" && sectionName !== "secondary weapons") {
      continue;
    }

    for (const field of section.entries) {
      const key = field.key.trim().toLowerCase();

      if (field.sigil === "$" && key === "name") {
        current = {
          name: stripHiddenNamePrefix(field.value.trim()),
          nameLine: field.line,
          modelFile: null,
          modelFileLine: null,
          techModel: null,
          techModelLine: null,
          externalModelFile: null,
          externalModelFileLine: null,
          damageType: null,
          damageTypeLine: null,
          armorType: null,
          armorTypeLine: null,
          muzzleflash: null,
          muzzleflashLine: null,
          ssmClass: null,
          ssmClassLine: null,
          textureRefs: [],
          soundRefs: [],
          miscFieldRefs: [],
          substituteRefs: [],
          nameListRefs: [],
          conditionalImpactArmorRefs: [],
          noCreate: false,
          remove: false,
        };
        entries.push(current);
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
        } else if (PLUS_TEXTURE_FIELDS.has(key) && field.value.trim()) {
          current.textureRefs.push({ sigil: field.sigil, field: field.key.trim(), line: field.line, value: field.value.trim() });
        } else if (SOUND_FIELDS.has(key) && field.value.trim()) {
          current.soundRefs.push({ sigil: field.sigil, field: field.key.trim(), line: field.line, value: field.value.trim() });
        } else if (NAME_LIST_FIELDS.has(key) && field.value.trim()) {
          const names = splitNameList(field.value);
          if (names.length > 0) {
            current.nameListRefs.push({
              field: field.key.trim(),
              kind: NAME_LIST_FIELDS.get(key) as WeaponNameListKind,
              line: field.line,
              names,
            });
          }
        } else if (key === "armor type" && field.value.trim()) {
          current.conditionalImpactArmorRefs.push({ sigil: field.sigil, field: field.key.trim(), line: field.line, value: field.value.trim() });
        }
        continue;
      }

      if (field.sigil === "@") {
        if (AT_TEXTURE_FIELDS.has(key) && field.value.trim()) {
          current.textureRefs.push({ sigil: field.sigil, field: field.key.trim(), line: field.line, value: field.value.trim() });
        }
        continue;
      }

      if (key === "model file") {
        current.modelFile = field.value.trim();
        current.modelFileLine = field.line;
      } else if (key === "tech model") {
        current.techModel = field.value.trim();
        current.techModelLine = field.line;
      } else if (key === "external model file") {
        current.externalModelFile = field.value.trim();
        current.externalModelFileLine = field.line;
      } else if (key === "damage type") {
        current.damageType = field.value.trim();
        current.damageTypeLine = field.line;
      } else if (key === "armor type") {
        current.armorType = field.value.trim();
        current.armorTypeLine = field.line;
      } else if (key === "muzzleflash" && field.value.trim()) {
        current.muzzleflash = field.value.trim();
        current.muzzleflashLine = field.line;
      } else if (key === "ssm" && field.value.trim()) {
        current.ssmClass = field.value.trim();
        current.ssmClassLine = field.line;
      } else if (key === "substitute" && field.value.trim()) {
        // Repeatable ("while") - see WeaponSubstituteRef. field.value is just the
        // substitute weapon name; +period:/+offset:/+index: are separate following
        // fields, already excluded from miscFieldRefs by not being $-sigil.
        current.substituteRefs.push({ name: field.value.trim(), line: field.line });
      } else if (DOLLAR_TEXTURE_FIELDS.has(key) && field.value.trim()) {
        current.textureRefs.push({ sigil: field.sigil, field: field.key.trim(), line: field.line, value: field.value.trim() });
      } else if (SOUND_FIELDS.has(key) && field.value.trim()) {
        current.soundRefs.push({ sigil: field.sigil, field: field.key.trim(), line: field.line, value: field.value.trim() });
      } else if (!HANDLED_TOP_LEVEL_KEYS.has(key) && field.value.trim()) {
        current.miscFieldRefs.push({ sigil: field.sigil, field: field.key.trim(), line: field.line, value: field.value.trim() });
      }
    }
  }

  return entries;
}

/** The weapon entry whose `$Name:` most recently precedes `line` (entries are in document order). */
export function findCurrentWeaponEntry(entries: WeaponEntryInfo[], line: number): WeaponEntryInfo | null {
  let candidate: WeaponEntryInfo | null = null;
  for (const entry of entries) {
    if (entry.nameLine <= line) {
      candidate = entry;
    } else {
      break;
    }
  }
  return candidate;
}
