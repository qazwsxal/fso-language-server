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
    "POF target file",
    "POF target LOD",
    "Detail distance",
    "Enable Team Colors",
    "Default Team",
    "Show damage",
    "Dying Gravity Const",
    "Density",
    "Damp",
    "Rotdamp",
    "Max Velocity",
    "Rotation time",
    "Rear Velocity",
    "Forward accel",
    "Forward decel",
    "Slide accel",
    "Slide decel",
    "Expl inner rad",
    "Expl outer rad",
    "Expl damage",
    "Expl blast",
    "Expl Propagates",
    "Shockwave Speed",
    "Explosion Animations",
    "Allowed PBanks",
    "Allowed Dogfight PBanks",
    "Default PBanks",
    "Allowed SBanks",
    "Allowed Dogfight SBanks",
    "Default SBanks",
    "SBank Capacity",
    "Shields",
    "Shield Color",
    "Power Output",
    "Max Oclk Speed",
    "Max Weapon Eng",
    "Hitpoints",
    "Armor Type",
    "Shield Armor Type",
    "Flags",
    "AI Class",
    "Afterburner",
    "Countermeasure type",
    "Countermeasures",
    "Scan time",
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
    "Ship IFF Colors",
    "Target Priority Groups",
    "Trail",
    "Thruster",
    "Subsystem",
  ],
  /**
   * A turret's own `$Flags:`/`$Armor Type:`/etc. inside a `$Subsystem:` block are
   * block-local, not the ship-level fields of the same name - see nestedScopeStartField's
   * doc comment in schemas/types.ts for the real-file false-positive this fixes.
   */
  nestedScopeStartField: "Subsystem",
};
