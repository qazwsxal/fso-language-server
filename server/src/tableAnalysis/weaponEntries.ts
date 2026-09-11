import { TableSection } from "../parser";
import { stripHiddenNamePrefix } from "./nameNormalization";

export interface WeaponTextureRef {
  sigil: "$" | "+" | "@";
  field: string;
  line: number;
  value: string;
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
  ...DOLLAR_TEXTURE_FIELDS,
  ...SOUND_FIELDS,
]);

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
          textureRefs: [],
          soundRefs: [],
          miscFieldRefs: [],
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
