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
  /** Line of the `$POF file:` entry that set `modelFile`, or null if none was seen yet. Lets F12 on that line open the 3D viewer at the model's root instead of only working on `$Subsystem:` lines. */
  modelFileLine: number | null;
  /** From `$Cockpit POF file:` (confirmed against ship.cpp's `cockpit_pof_file` field) - the 3D cockpit interior model shown when flying this ship. */
  cockpitModelFile: string | null;
  cockpitModelFileLine: number | null;
  /** From `$POF file Techroom:` (confirmed against ship.cpp's `pof_file_tech` field) - the separate POF shown in the tech room / ship database, ships.tbl's equivalent of weapons.tbl's `$Tech Model:`. */
  techModel: string | null;
  techModelLine: number | null;
  /** From `$POF target file:` (confirmed against ship.cpp's `pof_file_hud` field) - a low-detail model substituted in the HUD target monitor. */
  hudTargetModelFile: string | null;
  hudTargetModelFileLine: number | null;
  /**
   * From `+Generic Debris POF file:` (confirmed against ship.cpp's `generic_debris_pof_file`
   * field) - the debris-chunk model used when this ship explodes, if it has no per-
   * subsystem debris of its own. A `+`-sigil sub-field nested inside the `$Debris:`
   * block, matched by key alone regardless of the enclosing block (same approach as the
   * cross-block sound fields below) since this flat extractor has no general block-scope
   * tracking beyond `$Subsystem:`.
   */
  genericDebrisModelFile: string | null;
  genericDebrisModelFileLine: number | null;
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
  /**
   * From `$Explosion Animations:` - references fireball.tbl entries via `fireball_info_lookup()`.
   * Confirmed (live-verified against fireballs.cpp): the lookup matches ONLY against each
   * fireball.tbl entry's `unique_id` field - which is either explicitly set via
   * `$Unique ID:`, or auto-generated (`fireball_generate_unique_id()`, something like
   * `"Custom Fireball %d"`) for a `$Name:`-only entry. The auto-generated id is NOT
   * derived from `$Name:` at all, so a fireball.tbl entry that only specifies `$Name:`
   * is not meaningfully referenceable from here - only `$Unique ID:`-keyed entries
   * should be checked against. Ship-level only.
   */
  explosionAnimations: string[];
  explosionAnimationsLine: number | null;
  /**
   * From `$Target Priority Groups:` - references objecttypes.tbl entries. Confirmed
   * (live-verified against ship.cpp): matched via `stricmp()` against `Ai_tp_list[].name`,
   * which is populated ONLY by `parse_ai_target_priorities()` under objecttypes.tbl's
   * `#Target Priorities` section - NOT `#Weapon Targeting Priorities` (a same-named field
   * reused at the ship-type level under `#Ship Types`, per the same shared-field-name-at-
   * multiple-structural-levels pattern already confirmed for `$Default PBanks:`/
   * `$Default SBanks:` - see ShipSubsystemRef's doc comment). Ship-level only.
   */
  targetPriorityGroups: string[];
  targetPriorityGroupsLine: number | null;
  /**
   * From `$Flags:` (ship-level only, same `$Subsystem:`-scoping caveat as the other
   * cross-referencing fields above - subsystems have their own, differently-shaped
   * `$Flags:`). Confirmed against ship.cpp: each list entry is checked against BOTH the
   * static `Ship_flags[]` enum (see KNOWN_SHIP_FLAGS) AND objecttypes.tbl's `#Ship Types`
   * section (`ship_type_name_lookup()`) - an entry matching EITHER is accepted; only one
   * matching neither is a real "Bogus string in ship flags" warning. This dual-target
   * validation is why `$Flags:` wasn't cross-referenced at all until now - naively
   * checking only one target would false-positive on every legitimate use of the other.
   */
  flags: string[];
  flagsLine: number | null;
  /** Bitmap/animation-referencing fields, confirmed against ship.cpp's field list. */
  textureRefs: ShipTextureRef[];
  /**
   * Every other top-level `$Field:` this entry sets that isn't one of the dedicated,
   * specially-handled fields above (or a texture/sound field) - a generic catch-all so
   * the "effective definition" view can show the whole entry rather than just the
   * handful of fields with custom cross-referencing logic. Deliberately scoped to `$`-
   * sigil fields only, and only outside a `$Subsystem:` block: `+`/`@`-sigil fields are
   * overwhelmingly sub-fields of a nested block (e.g. `+BeamSound:` under `$BeamInfo:`)
   * that this flat, non-block-aware extractor has no way to distinguish from a genuine
   * top-level field, so dumping them flat would misleadingly imply they're ship-level
   * scalars. See fso-table-fields-reference project memory for the full field catalog -
   * most complex fields (`$Shields:`, `$Debris:`, `$Afterburner:`, etc.) open a
   * multi-line `+`-subfield block and so are intentionally NOT covered by this bucket.
   */
  miscFieldRefs: ShipTextureRef[];
  /**
   * Sound-referencing fields (ship-level and per-subsystem alike, e.g. `$EngineSnd:`,
   * `$AliveSnd:` inside a `$Subsystem:` block) - confirmed (live-verified against
   * ship.cpp/gamesnd.cpp, see [[fso-gamesnd-lookup]] project memory) that every one of
   * these resolves via `parse_game_sound()` against sounds.tbl's Game Sounds section
   * only (never Interface/Flyby/Environment sounds). Reuses ShipTextureRef's shape
   * (sigil/field/line/value) since the "does this name exist in some index" cross-check
   * is identical in form to a texture reference, just against a different index.
   */
  soundRefs: ShipTextureRef[];
  /** From `$Countermeasure type:` (confirmed against ship.cpp: `weapon_info_lookup()`) - references a weapons.tbl weapon name. Non-beam weapons only; the engine warns and ignores a beam given here. Ship-level only. */
  countermeasureType: string | null;
  countermeasureTypeLine: number | null;
  /** From `$Default Team:` (confirmed against ship.cpp: `Team_Colors.find()`) - references a colors.tbl `$Team Name:` entry, or the literal sentinel `"none"` (meaning no team colors). Ship-level only. */
  defaultTeam: string | null;
  defaultTeamLine: number | null;
  /** From `+Use Template:` (confirmed against ship.cpp: `ship_template_lookup()`) - references a `$Template:` entry's name in this same file's `#Ship Templates` section (or a `.tbm` layer's). Only meaningful right after `$Name:`/`+nocreate`/`+remove`, before any other field - `parse_ship()`'s clone-then-continue-parsing prelude. */
  useTemplate: string | null;
  useTemplateLine: number | null;
  /** From `+Use Ship as Template:` (confirmed against ship.cpp: `ship_info_lookup_sub()`) - references ANOTHER ship class's `$Name:` (not a template), which must already be defined earlier in the parse order. Same prelude-only positioning as `useTemplate` above. */
  useShipAsTemplate: string | null;
  useShipAsTemplateLine: number | null;
  /**
   * `+Seen By:`/`+When IFF Is:` sub-fields of a repeatable `$Ship IFF Colors:`/
   * `$Ship IFF Colours:` block (confirmed against ship.cpp: both resolved via
   * `iff_lookup()`) - each occurrence contributes two iff_defs.tbl name references, one
   * per field. Reuses ShipTextureRef's shape; matched by key alone regardless of the
   * enclosing block, same rationale as genericDebrisModelFile above.
   */
  iffColorRefs: ShipTextureRef[];
  /** Modular-table-only sentinels (see fso-table-format): only relevant when merging .tbm layers. */
  noCreate: boolean;
  remove: boolean;
}

/** A `#Ship Templates` section entry - a reusable field-value preset referenced by ship classes' `+Use Template:` (and possibly by other templates' own `+Use Template:`, for template hierarchies). Deliberately lightweight: only the name/location and its own `+Use Template:` chain are extracted, not the full field set extractShipEntries() captures for real ship classes - templates exist purely as a "clone from" source, and the LSP's only need for them is resolving/validating that `+Use Template:` reference. */
export interface ShipTemplateEntryInfo {
  name: string;
  nameLine: number;
  useTemplate: string | null;
  useTemplateLine: number | null;
}

/**
 * Every string ship.cpp's static `Ship_flags[]` array (`ship.cpp`, ~line 449) accepts as
 * a `$Flags:` list entry, lowercased - the "recognized engine flag" half of `$Flags:`'s
 * dual-target validation (see ShipEntryInfo.flags's doc comment). Transcribed directly
 * from the array's `name` column, including the one entry explicitly marked obsolete
 * ("ballistic primaries" - still accepted, just deprecated) - deprecation warnings aren't
 * modeled here, only "recognized at all" is.
 */
export const KNOWN_SHIP_FLAGS = new Set([
  "no_collide",
  "player_ship",
  "default_player_ship",
  "repair_rearm",
  "cargo",
  "fighter",
  "bomber",
  "transport",
  "freighter",
  "capital",
  "supercap",
  "drydock",
  "cruiser",
  "navbuoy",
  "sentrygun",
  "escapepod",
  "stealth",
  "no type",
  "ship copy",
  "in tech database",
  "in tech database multi",
  "don't collide invisible",
  "big damage",
  "corvette",
  "gas miner",
  "awacs",
  "knossos",
  "no_fred",
  "flash",
  "surface shields",
  "show ship",
  "generate icon",
  "no weapon damage scaling",
  "gun convergence",
  "no thruster geometry noise",
  "intrinsic no shields",
  "dynamic primary linking",
  "no primary linking",
  "no pain flash",
  "no ets",
  "no lighting",
  "auto spread shields",
  "model point shields",
  "repair disabled subsystems",
  "don't bank when turning",
  "don't clamp max velocity",
  "instantaneous acceleration",
  "large ship deathroll",
  "disable all generic impact debris",
  "disable all generic explosion debris",
  "ballistic primaries",
  // Typo-tolerant/deprecated aliases checked by separate stricmp() calls right after the
  // Ship_flags[] loop in parse_ship_values() - "no_collide" itself is already covered
  // above, so only the additional spellings/strings are listed here.
  "no-collide",
  "dont collide invisible",
  "dont bank when turning",
  "dont clamp max velocity",
  "no impact debris",
]);

const TEXTURE_FIELDS = new Set([
  "shield_icon",
  "ship_icon",
  "ship_anim",
  "ship_overhead",
  "thruster normal flame",
  "thruster afterburner flame",
]);

/**
 * The four `$Briefing icon...:` fields are NOT plain texture fields even though they
 * end up resolving a texture name: `parse_and_add_briefing_icon_info()` (ship.cpp)
 * reads NO value on the `$Briefing icon:` line itself - the actual filename always
 * comes from a nested `+Regular:` sub-field (with `+Fade:`/`+Highlight:` as further
 * optional siblings). A real Blue Planet-family file (BtA) writes `+Regular:` on the
 * SAME line as `$Briefing icon:` (e.g. `$Briefing icon: +Regular: iconapollo`) - since
 * this project's parser is line-based (a new field requires a sigil at the START of a
 * line, per parser.ts), that whole "+Regular: iconapollo" text was captured as if it
 * were `$Briefing icon:`'s own raw value when these fields were (wrongly) included in
 * TEXTURE_FIELDS, producing a false "texture ... not found" diagnostic literally
 * containing the "+Regular:" text. Handled separately below instead, covering both the
 * same-line and (the more common) next-line `+Regular:` shapes.
 */
const BRIEFING_ICON_FIELDS = new Set([
  "briefing icon",
  "briefing icon with cargo",
  "briefing wing icon",
  "briefing wing icon with cargo",
]);

/**
 * Every ships.tbl field confirmed (see [[fso-gamesnd-lookup]] project memory) to resolve
 * a sound name via `parse_game_sound()`/`parse_ship_sound()` - ship-level and
 * per-subsystem fields both included, matched by key alone regardless of sigil ($/+)
 * since `+Ambient Sound:`/`+Collision Sound Light:`/`+Collision Sound Heavy:` are each
 * confirmed to appear twice, under two different parent blocks, with identical spelling.
 */
const SOUND_FIELDS = new Set([
  "enginesnd",
  "glidestartsnd",
  "glideendsnd",
  "flyby sound",
  "landing sound",
  "collision sound light",
  "collision sound heavy",
  "collision sound shielded",
  "ambient sound",
  "explosion sound",
  "autoaim lock snd",
  "autoaim lost snd",
  "shockwave sound",
  "startsnd",
  "loopsnd",
  "stopsnd",
  "cockpitenginesnd",
  "fullthrottlesnd",
  "zerothrottlesnd",
  "throttleupsnd",
  "throttledownsnd",
  "afterburnersnd",
  "afterburnerengagesnd",
  "afterburnerfailedsnd",
  "missiletrackingsnd",
  "missilelockedsnd",
  "primarycyclesnd",
  "secondarycyclesnd",
  "targetacquiredsnd",
  "primaryfirefailedsnd",
  "secondaryfirefailedsnd",
  "heatseekerlaunchwarningsnd",
  "aspectseekerlaunchwarningsnd",
  "missilelockwarningsnd",
  "heatseekerproximitywarningsnd",
  "aspectseekerproximitywarningsnd",
  "missileevadedsnd",
  "cargoscanningsnd",
  "deathrollsnd",
  "explosionsnd",
  "subsysexplosionsnd",
  "alivesnd",
  "deadsnd",
  "rotationsnd",
  "turret base rotationsnd",
  "turret gun rotationsnd",
]);

/**
 * Every ship-level `$Field:` key with dedicated, specially-handled extraction above -
 * excluded from the generic `miscFieldRefs` catch-all so a field doesn't show up twice
 * (once with its proper cross-referencing/typed display, once as a raw misc line).
 */
const HANDLED_TOP_LEVEL_KEYS = new Set([
  "pof file",
  "cockpit pof file",
  "pof file techroom",
  "pof target file",
  "countermeasure type",
  "default team",
  "default pbanks",
  "default sbanks",
  "armor type",
  "shield armor type",
  "species",
  "ai class",
  "explosion animations",
  "target priority groups",
  "flags",
  ...TEXTURE_FIELDS,
  ...BRIEFING_ICON_FIELDS,
  ...SOUND_FIELDS,
]);

/** Extracts per-ship model-file + subsystem-reference info from a parsed ships.tbl/*-shp.tbm. */
export function extractShipEntries(sections: TableSection[]): ShipEntryInfo[] {
  const entries: ShipEntryInfo[] = [];
  let current: ShipEntryInfo | null = null;
  let inSubsystemScope = false;
  let currentSubsystem: ShipSubsystemRef | null = null;
  /** Set when a `$Briefing icon...:` field with no inline `+Regular:` was just seen, so the NEXT `+Regular:` field (on a following line) is known to belong to it. */
  let pendingBriefingIconField: string | null = null;

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
          modelFileLine: null,
          cockpitModelFile: null,
          cockpitModelFileLine: null,
          techModel: null,
          techModelLine: null,
          hudTargetModelFile: null,
          hudTargetModelFileLine: null,
          genericDebrisModelFile: null,
          genericDebrisModelFileLine: null,
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
          explosionAnimations: [],
          explosionAnimationsLine: null,
          targetPriorityGroups: [],
          targetPriorityGroupsLine: null,
          flags: [],
          flagsLine: null,
          textureRefs: [],
          soundRefs: [],
          miscFieldRefs: [],
          countermeasureType: null,
          countermeasureTypeLine: null,
          defaultTeam: null,
          defaultTeamLine: null,
          useTemplate: null,
          useTemplateLine: null,
          useShipAsTemplate: null,
          useShipAsTemplateLine: null,
          iffColorRefs: [],
          noCreate: false,
          remove: false,
        };
        entries.push(current);
        inSubsystemScope = false;
        currentSubsystem = null;
        pendingBriefingIconField = null;
        continue;
      }
      if (!current) {
        continue;
      }

      if (TEXTURE_FIELDS.has(key) && field.value.trim()) {
        current.textureRefs.push({ sigil: field.sigil, field: field.key.trim(), line: field.line, value: field.value.trim() });
      }

      if (field.sigil === "$" && !BRIEFING_ICON_FIELDS.has(key)) {
        // Any other top-level field ends the window in which a following `+Regular:`
        // could belong to a pending briefing-icon field.
        pendingBriefingIconField = null;
      }

      if (field.sigil === "$" && BRIEFING_ICON_FIELDS.has(key)) {
        const inlineMatch = /\+Regular:\s*([^+]*)/i.exec(field.value);
        if (inlineMatch && inlineMatch[1].trim()) {
          current.textureRefs.push({ sigil: "+", field: field.key.trim(), line: field.line, value: inlineMatch[1].trim() });
        } else {
          pendingBriefingIconField = field.key.trim();
        }
      } else if (field.sigil === "+" && key === "regular" && pendingBriefingIconField && field.value.trim()) {
        current.textureRefs.push({ sigil: "+", field: pendingBriefingIconField, line: field.line, value: field.value.trim() });
        pendingBriefingIconField = null;
      }

      if (SOUND_FIELDS.has(key) && field.value.trim()) {
        current.soundRefs.push({ sigil: field.sigil, field: field.key.trim(), line: field.line, value: field.value.trim() });
      }

      if (field.sigil === "+") {
        // Several confirmed sound fields (+Ambient Sound:/+Landing Sound:/etc. - see
        // fso-gamesnd-lookup project memory) use the "+" sigil, so the texture/sound-ref
        // capture above MUST run before this branch's `continue` - an earlier version
        // had it after, which meant every "+"-sigil sound field was silently never
        // captured at all (caught by a unit test, not by hand-inspection).
        if (key === "nocreate") {
          current.noCreate = true;
        } else if (key === "remove") {
          current.remove = true;
        } else if (key === "generic debris pof file" && field.value.trim()) {
          current.genericDebrisModelFile = field.value.trim();
          current.genericDebrisModelFileLine = field.line;
        } else if (key === "use template" && field.value.trim()) {
          current.useTemplate = field.value.trim();
          current.useTemplateLine = field.line;
        } else if (key === "use ship as template" && field.value.trim()) {
          current.useShipAsTemplate = field.value.trim();
          current.useShipAsTemplateLine = field.line;
        } else if ((key === "seen by" || key === "when iff is") && field.value.trim()) {
          current.iffColorRefs.push({ sigil: field.sigil, field: field.key.trim(), line: field.line, value: field.value.trim() });
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
        current.modelFileLine = field.line;
      } else if (key === "cockpit pof file") {
        current.cockpitModelFile = field.value.trim();
        current.cockpitModelFileLine = field.line;
      } else if (key === "pof file techroom") {
        current.techModel = field.value.trim();
        current.techModelLine = field.line;
      } else if (key === "pof target file") {
        current.hudTargetModelFile = field.value.trim();
        current.hudTargetModelFileLine = field.line;
      } else if (key === "countermeasure type") {
        current.countermeasureType = field.value.trim();
        current.countermeasureTypeLine = field.line;
      } else if (key === "default team") {
        current.defaultTeam = field.value.trim();
        current.defaultTeamLine = field.line;
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
      } else if (key === "explosion animations") {
        current.explosionAnimations = splitNameList(field.value);
        current.explosionAnimationsLine = field.line;
      } else if (key === "target priority groups") {
        current.targetPriorityGroups = splitNameList(field.value);
        current.targetPriorityGroupsLine = field.line;
      } else if (key === "flags") {
        current.flags = splitNameList(field.value);
        current.flagsLine = field.line;
      } else if (field.sigil === "$" && !HANDLED_TOP_LEVEL_KEYS.has(key) && field.value.trim()) {
        current.miscFieldRefs.push({ sigil: field.sigil, field: field.key.trim(), line: field.line, value: field.value.trim() });
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

/**
 * Parses a `( "Name" "Name" ... )`-style parenthesized name list, same convention as
 * splitBankList() (both go through FSO's generic `stuff_int_list()`/name-lookup-list
 * reader, just with a different `ParseLookupType`), for fields whose members aren't
 * weapon names. Fallback splits on comma OR whitespace (unlike splitBankList's
 * comma-only fallback), since these lists' quoting convention isn't confirmed and a
 * bare `( Fighter Bomber )`-style unquoted, whitespace-separated list is plausible for
 * short identifier-style names.
 */
export function splitNameList(value: string): string[] {
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

/**
 * Extracts `#Ship Templates` section entries from a parsed ships.tbl/*-shp.tbm - the
 * `+Use Template:` cross-reference target. Confirmed against ship.cpp: the section is
 * `#Ship Templates` (NOT `#Templates`), entries are keyed by `$Template:` (NOT `$Name:`),
 * and `+nocreate` is accepted but explicitly ignored with a warning ("Ship templates can
 * not be modified") - so unlike `extractShipEntries()`, there's no noCreate/remove
 * merge-sentinel handling here at all.
 */
export function extractShipTemplateEntries(sections: TableSection[]): ShipTemplateEntryInfo[] {
  const entries: ShipTemplateEntryInfo[] = [];
  let current: ShipTemplateEntryInfo | null = null;

  for (const section of sections) {
    if (section.name.trim().toLowerCase() !== "ship templates") {
      continue;
    }

    for (const field of section.entries) {
      const key = field.key.trim().toLowerCase();

      if (field.sigil === "$" && key === "template") {
        current = {
          name: stripHiddenNamePrefix(field.value.trim()),
          nameLine: field.line,
          useTemplate: null,
          useTemplateLine: null,
        };
        entries.push(current);
        continue;
      }
      if (!current) {
        continue;
      }

      if (field.sigil === "+" && key === "use template" && field.value.trim()) {
        current.useTemplate = field.value.trim();
        current.useTemplateLine = field.line;
      }
    }
  }

  return entries;
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
