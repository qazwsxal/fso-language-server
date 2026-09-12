import { TableSchema } from "./types";

/**
 * weapons.tbl / *-wep.tbm schema.
 *
 * fields below is a mechanical, in-source-order extraction of every top-level
 * `$Field:` literal read by `parse_weapon()` in `code/weapon/weapons.cpp` (live-fetched
 * from the FSO GitHub source, not the wiki or guessed) - the same treatment ships.tbl's
 * schema got.
 *
 * `+`/`@`-sigil fields are NOT omitted (an earlier version of this file omitted them
 * categorically, on the reasoning that schemaValidator.ts never order-checks them
 * anyway - see schemaValidator.ts:78, still true). That reasoning stopped being
 * sufficient once fields ALSO became the data source for field-name completion
 * (server.ts's `schemaFieldCompletions()`, triggered for `$`/`+`/`@` alike): a real
 * field missing from fields is invisible to autocomplete even though it's
 * perfectly valid to type, which is a real regression in usefulness (concretely, this
 * is why `@Laser Bitmap:` didn't autocomplete - reported and fixed). So every `+`/`@`
 * field read directly in `parse_weapon()`'s own top-level flow is now included here too,
 * interleaved in true parse order alongside the `$` fields - EXCEPT fields only reachable
 * inside another optional block that itself opens a distinct sub-entity (e.g. the
 * homing-lock modifiers nested inside `$Homing:`'s heat/aspect branches, `$Trail:`'s
 * `+Bitmap:`/`+Width:`/etc., `$BeamInfo:`'s enormous nested cluster, `$Countermeasure:`,
 * `$Pspew:`, the `$Proximity Radius:`/`$MineInfo:` sub-fields, and similar) - those stay
 * excluded exactly as before, since including them would offer them at the wrong nesting
 * level and they were never order-checked or otherwise represented here regardless.
 * `+nocreate`/`+remove` are also excluded: they're modular-table merge directives, not
 * real per-entry data fields.
 *
 * Two earlier guessed entries, `Flash Impact Weapon Expl` and `HUD Target LOD`, were
 * CONFIRMED NOT TO EXIST anywhere in current weapons.cpp and have been removed - they
 * were flagging nothing (dead entries), but kept the schema looking more complete than
 * it was.
 *
 * Several modern/legacy field pairs only ever appear one-at-a-time in a real file (the
 * legacy one is parsed in an `else` branch when the modern one is absent) - both are
 * still included, adjacent, so whichever a real file uses lands in a sane relative
 * position: `Impact Effect`/`Impact Explosion` (+`Impact Explosion Radius`), `Piercing
 * Impact Effect`/`Piercing Impact Explosion`, `Muzzle Effect`/`Muzzleflash`. The
 * `$Piercing Impact Explosion:` field a real mod file was flagged for is exactly this
 * legacy fallback - it's real, not a typo, and is now in the schema.
 *
 * `Weapon Range` was previously listed as if a top-level `$` field; confirmed it's
 * actually `+Weapon Range:` (a real mod file and live source cross-check). It's back in
 * this list (along with `+Weapon Min Range:`/`+Weapon Optimum Range:`, its neighbors at
 * weapons.cpp ~2114-2139) now that `+`/`@` fields are included for completion purposes -
 * it's still never order-checked against, per schemaValidator.ts's `$`-only order logic.
 *
 * `Shockwave` (as a single block-opening field) does not exist; replaced with the real
 * flat `$Shockwave ...:`/`$Dinky shockwave:` field cluster.
 */
export const weaponsSchema: TableSchema = {
  name: "weapons.tbl",
  fileMatch: [/(^|[\\/])weapons\.tbl$/i, /-wep\.tbm$/i],
  sectionNames: ["Primary Weapons", "Secondary Weapons"],
  entryKeyField: "Name",
  fields: [
    "Name",
    "Alt name",
    "Subtype",
    "Title",
    "Description",
    "Tech Title",
    "Tech Anim",
    "Tech Description",
    "Turret Name",
    "Tech Model",
    "Icon_closeup_pos",
    "Icon_closeup_zoom",
    "Selection Effect",
    "FS2 effect grid color",
    "FS2 effect scanline color",
    "FS2 effect grid density",
    "FS2 effect wireframe color",
    "HUD Image",
    "Model file",
    "POF target LOD",
    "Detail distance",
    "External Model File",
    "Submodel Rotation Speed",
    "Submodel Rotation Acceleration",
    "Laser Bitmap",
    "Laser Head-on Bitmap",
    "Laser Glow",
    "Laser Glow Head-on Bitmap",
    "Laser Head-on Transition Angle",
    "Laser Head-on Transition Rate",
    "Laser Bitmap Color",
    "Laser Color",
    "Laser Color2",
    "Laser Length",
    "Multiply Laser Length By Frametime",
    "Laser Length Multiplier over Lifetime Curve",
    "Laser Head Radius",
    "Laser Tail Radius",
    "Laser Radius Multiplier over Lifetime Curve",
    "Laser Glow Length Scale",
    "Laser Glow Head Scale",
    "Laser Glow Tail Scale",
    "Laser Position Offset",
    "Laser Min Pixel Size",
    "Laser Opacity over Lifetime Curve",
    "Light color",
    "Light radius",
    "Light intensity",
    "Collision Radius Override",
    "Mass",
    "Velocity",
    "Fire Wait",
    "Damage",
    "Damage Time",
    "Angle of Incidence Damage Multiplier",
    "Damage Multiplier over Lifetime Curve",
    "Damage Type",
    "Arm time",
    "Arm distance",
    "Arm radius",
    "Detonation Range",
    "Detonation Radius",
    "Proximity Radius",
    "MineInfo",
    "Flak Detonation Accuracy",
    "Flak Targeting Accuracy",
    "Untargeted Flak Range Penalty",
    "Shockwave damage",
    "Shockwave damage type",
    "Blast Force",
    "Inner Radius",
    "Outer Radius",
    "Shockwave Radius Multiplier over Lifetime Curve",
    "Shockwave Speed",
    "Shockwave Rotation",
    "Shockwave Rotation Is Relative To Parent",
    "Shockwave Model",
    "Shockwave Name",
    "Shockwave Sound",
    "Dinky shockwave",
    "Armor Factor",
    "Shield Factor",
    "Subsystem Factor",
    "Lifetime Min",
    "Lifetime Max",
    "Lifetime",
    "Energy Consumed",
    "Cargo Size",
    "Autoaim FOV",
    "Convergence",
    "Homing",
    "Homing Auto-Target Method",
    "Swarm",
    "SwarmWait",
    "Acceleration Time",
    "Velocity Inherit",
    "Free Flight Time",
    "Free Flight Speed",
    "Free Flight Speed Factor",
    "Gravity Const",
    "PreLaunchSnd",
    "PreLaunchSnd Min Interval",
    "LaunchSnd",
    "CockpitLaunchSnd",
    "ImpactSnd",
    "Disarmed ImpactSnd",
    "Shield ImpactSnd",
    "FlyBySnd",
    "AmbientSnd",
    "StartFiringSnd",
    "LoopFiringSnd",
    "LinkedLoopFiringSnd",
    "EndFiringSnd",
    "TrackingSnd",
    "LockedSnd",
    "InFlightSnd",
    "Inflight sound type",
    "Model",
    "Rearm Rate",
    "Rearm Ammo Increment",
    "Disallow Support Rearm",
    "Weapon Range",
    "Weapon Min Range",
    "Weapon Optimum Range",
    "Pierce Objects",
    "Flags",
    "Trail",
    "Icon",
    "Anim",
    "Impact Effect",
    "Impact Explosion",
    "Impact Explosion Radius",
    "Shield Impact Explosion Radius",
    "Shield Impact Effect Radius",
    "Dinky Impact Effect",
    "Dinky Impact Explosion",
    "Dinky Impact Explosion Radius",
    "Piercing Impact Effect",
    "Piercing Impact Explosion",
    "Piercing Impact Radius",
    "Piercing Impact Velocity",
    "Piercing Impact Splash Velocity",
    "Piercing Impact Variance",
    "Piercing Impact Life",
    "Piercing Impact Particles",
    "Conditional Impact",
    "Inflight Effect",
    "Freeflight Effect",
    "Ignition Effect",
    "Homed Flight Effect",
    "Unhomed Flight Effect",
    "Muzzle Effect",
    "Muzzleflash",
    "EMP Intensity",
    "EMP Time",
    "Recoil Modifier",
    "Shudder Modifier",
    "Leech Weapon",
    "Leech Afterburner",
    "Vampiric Healing Factor",
    "Corkscrew",
    "Electronics",
    "Spawn Angle",
    "Spawn Minimum Angle",
    "Spawn Interval",
    "Spawn Chance",
    "Spawn Effect",
    "Spawn Aimed",
    "Spawn Aim Lead",
    "Lifetime Variation Factor When Child",
    "Local SSM",
    "Countermeasure",
    "BeamInfo",
    "Type 5 Beam Options",
    "Section",
    "Pspew",
    "Tag",
    "SSM",
    "FOF",
    "Firing Pattern",
    "Shots",
    "Cycle Multishot",
    "decal",
    "Impact Decal",
    "Transparent",
    "Weapon Hitpoints",
    "Armor Type",
    "Burst Shots",
    "Burst Delay",
    "Burst Flags",
    "Thruster Flame Effect",
    "Thruster Glow Effect",
    "Thruster Glow Radius Factor",
    "Failure Rate",
    "Animations",
    "Driven Animations",
    "substitute",
    "Score",
    "Custom data",
    "Custom Strings",
  ],
};
