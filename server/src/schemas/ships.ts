import { TableSchema } from "./types";

/**
 * ships.tbl / *-shp.tbm schema.
 *
 * Field order below is grounded in a real Blue Planet ships.tbm (a full GTF Apollo
 * entry), cross-checked against FSO's ship.cpp - including a full mechanical source
 * extraction now recorded in the fso-table-fields-reference project memory, which this
 * list is a curated subset of (the full list runs to 100+ fields; only the ones this
 * project actually order-checks or cross-references are included here, to keep the
 * schema legible - see that memory file for the exhaustive version).
 *
 * Two important corrections an earlier guess got wrong, both since confirmed against
 * source: the model file field is `$POF file:`, NOT `$Model File:` (that's a
 * weapons.tbl-only field name - see weapons.ts); and `+Armor:` is a purely cosmetic
 * tech-room display string (e.g. "Medium") with NO relation to armor.tbl - the real
 * armor.tbl cross-references are the top-level `$Armor Type:` (hull) and
 * `$Shield Armor Type:` (shield) fields, confirmed to sit between `$Hitpoints:`-area
 * fields and `$Flags:`.
 *
 * Extended in a later pass (running the real, compiled extension against a real Blue
 * Planet install surfaced these as false "possibly misplaced" - a field genuinely
 * belonging to exactly one OTHER schema, per schemaValidator.ts, gets flagged when it's
 * missing from ITS OWN table's list too): `Alt name` and `Countermeasure type` are
 * shared with weapons.tbl/species_defs.tbl respectively (both real ships.tbl fields,
 * just also real elsewhere under the same name); `Cockpit POF file`/`POF file Techroom`/
 * `POF target file`/`POF target LOD`/`Default Team`/`Explosion Animations`/`Target
 * Priority Groups`/`Ship IFF Colors`/the four `Briefing icon...` variants are real
 * ships.tbl-only fields this project already extracts/cross-references (see
 * shipEntries.ts) that had simply never been added here.
 *
 * A further pass (enabling `unknownFieldSeverity` surfaced these as noise) added every
 * ship-level sound field (`$EngineSnd:` through `$SubsysExplosionSnd:`, all resolving
 * against sounds.tbl - see the fso-gamesnd-lookup project memory), in their real call
 * order confirmed directly against ship.cpp (`$EngineSnd:`/`$GlideStartSnd:`/
 * `$GlideEndSnd:`/`$Flyby Sound:` at ship.cpp:4399-4411, then `parse_ship_sounds()`'s
 * cluster at ship.cpp:2145-2170, both sitting between `$Scan time:` and `$Closeup_pos:`).
 * The five per-subsystem sound fields (`AliveSnd`/`DeadSnd`/`RotationSnd`/`Turret Base
 * RotationSnd`/`Turret Gun RotationSnd`, ship.cpp:5440-5444) are deliberately NOT listed
 * here - they only ever appear inside a `$Subsystem:` block, which `nestedScopeStartField`
 * already excludes from both order- and unknown-field checking entirely.
 *
 * The same pass also fixed a latent relative-order bug (never triggered by a real file
 * yet, but would have): `Trail`/`Thruster` actually parse (ship.cpp:4833/4902) BEFORE
 * `Ship IFF Colors`/`Target Priority Groups` (ship.cpp:5059/5087), the reverse of what
 * this list previously said. Also added the real `$Radar Image 2D:` field
 * (ship.cpp:5041), which sits between them.
 *
 * The rest of the fields added in that same pass (all mechanically confirmed against
 * ship.cpp's actual parse order, not guessed): `Texture Replace`, `Collision LOD`, `ND`
 * (a dummied-out legacy palette-color field the engine still parses and discards),
 * `Damage Lightning Type`, `Impact Spew`/`Impact Spew Effect`, `Damage Spew`/`Damage
 * Spew Effect`, `Debris` (the block-opening field itself, distinct from its
 * `+Generic Debris POF file:` sub-field already tracked in shipEntries.ts), `Banking
 * Constant`, `Glide`, `Autoaim FOV`/`Convergence` (ship-level turret-aim fields that
 * happen to share a literal name with unrelated per-weapon fields in weapons.ts - a
 * second legitimate owner, not a typo), the full `Warpin `/`Warpout ` field cluster
 * (`parse_warp_params()`, ship.cpp:2544), `Vaporize Percent Chance`, `Shockwave Count`,
 * `Shockwave Sound` (also ship-level, also shared with weapons.ts), `Weapon Model Draw
 * Distance`, `PBank Capacity` (present for SBanks as `SBank Capacity` already, but
 * missing for PBanks - same `parse_weapon_bank_capacities()` call, ship.cpp:2457),
 * `Show Primary Models`/`Show Secondary Models`, `Shield Regeneration Rate`/`Weapon
 * Regeneration Rate`, `Hull Repair Rate`/`Support Hull Repair Rate`/`Subsystem Repair
 * Rate`/`Support Subsystem Repair Rate`, `Trails` (ship.cpp:4283, distinct from the
 * per-thruster-point `$Trail:` block), and the `Thruster Bitmap 1/1a/2/2a/3/3a`/
 * `Thruster01 Radius factor`/`Thruster02 Length factor`/`Thruster Bitmap Distortion[ a]`
 * cluster (ship.cpp:4617-4692).
 */
export const shipsSchema: TableSchema = {
  name: "ships.tbl",
  fileMatch: [/(^|[\\/])ships\.tbl$/i, /-shp\.tbm$/i],
  sectionNames: ["Ship Classes"],
  entryKeyField: "Name",
  fieldOrder: [
    "Name",
    "Alt name",
    "Short name",
    "Species",
    "Cockpit POF file",
    "POF file",
    "POF file Techroom",
    "Texture Replace",
    "POF target file",
    "POF target LOD",
    "Detail distance",
    "Collision LOD",
    "ND",
    "Enable Team Colors",
    "Default Team",
    "Show damage",
    "Damage Lightning Type",
    "Impact Spew Effect",
    "Impact Spew",
    "Damage Spew Effect",
    "Damage Spew",
    "Dying Gravity Const",
    "Debris",
    "Density",
    "Damp",
    "Rotdamp",
    "Banking Constant",
    "Max Velocity",
    "Rotation time",
    "Rear Velocity",
    "Forward accel",
    "Forward decel",
    "Slide accel",
    "Slide decel",
    "Glide",
    "Autoaim FOV",
    "Convergence",
    "Warpin type",
    "Warpin Start Sound",
    "Warpin End Sound",
    "Warpin speed",
    "Warpin time",
    "Warpin decel exp",
    "Warpin radius",
    "Warpin animation",
    "Supercap warpin physics",
    "Warpout type",
    "Warpout Start Sound",
    "Warpout End Sound",
    "Warpout engage time",
    "Warpout speed",
    "Warpout time",
    "Warpout accel exp",
    "Warpout radius",
    "Warpout animation",
    "Supercap warpout physics",
    "Player warpout speed",
    "Expl inner rad",
    "Expl outer rad",
    "Expl damage",
    "Expl blast",
    "Expl Propagates",
    "Vaporize Percent Chance",
    "Shockwave Speed",
    "Shockwave Count",
    "Shockwave Sound",
    "Explosion Animations",
    "Weapon Model Draw Distance",
    "Allowed PBanks",
    "Allowed Dogfight PBanks",
    "Default PBanks",
    "PBank Capacity",
    "Show Primary Models",
    "Allowed SBanks",
    "Allowed Dogfight SBanks",
    "Default SBanks",
    "SBank Capacity",
    "Show Secondary Models",
    "Shields",
    "Shield Color",
    "Power Output",
    "Shield Regeneration Rate",
    "Weapon Regeneration Rate",
    "Max Oclk Speed",
    "Max Weapon Eng",
    "Hitpoints",
    "Hull Repair Rate",
    "Support Hull Repair Rate",
    "Subsystem Repair Rate",
    "Support Subsystem Repair Rate",
    "Armor Type",
    "Shield Armor Type",
    "Flags",
    "AI Class",
    "Afterburner",
    "Trails",
    "Countermeasure type",
    "Countermeasures",
    "Scan time",
    "EngineSnd",
    "GlideStartSnd",
    "GlideEndSnd",
    "Flyby Sound",
    "CockpitEngineSnd",
    "FullThrottleSnd",
    "ZeroThrottleSnd",
    "ThrottleUpSnd",
    "ThrottleDownSnd",
    "AfterburnerSnd",
    "AfterburnerEngageSnd",
    "AfterburnerFailedSnd",
    "MissileTrackingSnd",
    "MissileLockedSnd",
    "PrimaryCycleSnd",
    "SecondaryCycleSnd",
    "TargetAcquiredSnd",
    "PrimaryFireFailedSnd",
    "SecondaryFireFailedSnd",
    "HeatSeekerLaunchWarningSnd",
    "AspectSeekerLaunchWarningSnd",
    "MissileLockWarningSnd",
    "HeatSeekerProximityWarningSnd",
    "AspectSeekerProximityWarningSnd",
    "MissileEvadedSnd",
    "CargoScanningSnd",
    "DeathRollSnd",
    "ExplosionSnd",
    "SubsysExplosionSnd",
    "Closeup_pos",
    "Closeup_zoom",
    "Shield_icon",
    "Ship_icon",
    "Ship_anim",
    "Ship_overhead",
    "Briefing icon",
    "Briefing icon with cargo",
    "Briefing wing icon",
    "Briefing wing icon with cargo",
    "Score",
    "Thruster Normal Flame",
    "Thruster Afterburner Flame",
    "Thruster Bitmap 1",
    "Thruster Bitmap 1a",
    "Thruster01 Radius factor",
    "Thruster Bitmap 2",
    "Thruster Bitmap 2a",
    "Thruster02 Length factor",
    "Thruster Bitmap 3",
    "Thruster Bitmap 3a",
    "Thruster Bitmap Distortion",
    "Thruster Bitmap Distortion a",
    "Trail",
    "Thruster",
    "Glowpoint overrides",
    "Radar Image 2D",
    "Ship IFF Colors",
    "Target Priority Groups",
    "Subsystem",
  ],
  /**
   * A turret's own `$Flags:`/`$Armor Type:`/etc. inside a `$Subsystem:` block are
   * block-local, not the ship-level fields of the same name - see nestedScopeStartField's
   * doc comment in schemas/types.ts for the real-file false-positive this fixes.
   */
  nestedScopeStartField: "Subsystem",
};
