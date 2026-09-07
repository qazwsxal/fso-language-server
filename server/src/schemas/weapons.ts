import { TableSchema } from "./types";

/**
 * weapons.tbl / *-wep.tbm schema.
 *
 * Same caveat as ships.ts: this is a best-effort ordering of the well-documented
 * top-level fields of a weapon class entry (general info -> visual/model ->
 * flight/damage stats -> homing -> impact/detonation effects), assembled from wiki
 * and community knowledge rather than transcribed from weapon_parse() in
 * FSO's weapons.cpp. Niche/rare fields are omitted rather than guessed at, so they're
 * simply treated as unknown (never flagged) until this list is extended against a
 * real retail weapons.tbl and the actual parser source.
 */
export const weaponsSchema: TableSchema = {
  name: "weapons.tbl",
  fileMatch: [/(^|[\\/])weapons\.tbl$/i, /-wep\.tbm$/i],
  sectionNames: ["Primary Weapons", "Secondary Weapons"],
  entryKeyField: "Name",
  fieldOrder: [
    "Name",
    "Short name",
    "Alt name",
    "Title",
    "Description",
    "Tech Title",
    "Tech Anim",
    "Tech Desc",
    "Model File",
    "Laser Bitmap",
    "Laser Glow",
    "Laser Color",
    "Laser Color2",
    "Laser Length",
    "Laser Head Radius",
    "Laser Tail Radius",
    "Mass",
    "Velocity",
    "Fire Wait",
    "Damage",
    "Damage Type",
    "Armor Factor",
    "Shield Factor",
    "Subsystem Factor",
    "Life Min",
    "Life Max",
    "Lifetime",
    "Energy Consumed",
    "Cargo Size",
    "Weapon Range",
    "Free Flight Time",
    "Homing",
    "Turn Time",
    "FOV",
    "Min Lock Time",
    "Lock Pixels Per Sec",
    "Catch-up Pixels/Sec",
    "Catch-up Penalty",
    "Icon",
    "Anim",
    "Impact Explosion",
    "Impact Explosion Radius",
    "Piercing Impact Effect",
    "Flash Impact Weapon Expl",
    "Trail",
    "Muzzleflash",
    "HUD Target LOD",
    "Shockwave",
    "Rearm Rate",
    "Swarm",
    "Corkscrew",
  ],
};
