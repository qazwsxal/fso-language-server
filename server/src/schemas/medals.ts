import { TableSchema } from "./types";

/**
 * medals.tbl / *-mdl.tbm schema.
 *
 * Short and conservative like armor.ts/aiProfiles.ts: medals.tbl entries are mostly
 * just an identity + display bitmap, without much else worth order-checking.
 *
 * Modular suffix confirmed as `-mdl.tbm`, NOT `-med.tbm` (an earlier guess) - live-verified
 * against `code/stats/medals.cpp`: `parse_modular_table("*-mdl.tbm", parse_medals_table)`.
 * The wrong suffix meant listMatchingFiles() would never find a single real medals.tbl
 * .tbm across any real mod, silently merging nothing.
 */
export const medalsSchema: TableSchema = {
  name: "medals.tbl",
  fileMatch: [/(^|[\\/])medals\.tbl$/i, /-mdl\.tbm$/i],
  sectionNames: ["Medals"],
  entryKeyField: "Name",
  fieldOrder: ["Name", "Bitmap", "Num Mods"],
};
