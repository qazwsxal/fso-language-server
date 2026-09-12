import { TableSchema } from "./types";

/**
 * species_defs.tbl / *-sdf.tbm schema.
 *
 * Confirmed against FSO's species_defs.cpp (parse_species_tbl) and a real bp-sdf.tbm:
 * entries are keyed by `$Species_Name:` (underscore - NOT `$Species Name:`, an earlier
 * incorrect guess that meant the entry-key field never matched anything, which in turn
 * meant the field-order tracker never reset between species and could misfire across
 * entry boundaries - see the hardening note in schemaValidator.ts). Field order:
 * Species_Name -> Default IFF -> FRED Color -> MiscAnims -> ThrustAnims -> ThrustGlows
 * -> AwacsMultiplier -> Countermeasure type -> Support ship -> Borrows Briefing Icons
 * from -> Borrows Flyby Sounds from. MiscAnims/ThrustAnims/ThrustGlows are themselves
 * `$`-fields whose contents (`+Debris_Texture:`, `+Pri_Normal:`, etc.) are `+`-sigil
 * sub-fields, not order-checked.
 */
export const speciesDefsSchema: TableSchema = {
  name: "species_defs.tbl",
  fileMatch: [/(^|[\\/])species_defs\.tbl$/i, /-sdf\.tbm$/i],
  sectionNames: ["Species Defs"],
  entryKeyField: "Species_Name",
  fields: [
    "Species_Name",
    "Default IFF",
    "FRED Color",
    "MiscAnims",
    "ThrustAnims",
    "ThrustGlows",
    "AwacsMultiplier",
    "Countermeasure type",
    "Support ship",
    "Borrows Briefing Icons from",
    "Borrows Flyby Sounds from",
  ],
};
