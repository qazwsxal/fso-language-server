import { TableSchema } from "./types";

/**
 * medals.tbl / *-med.tbm schema.
 *
 * Short and conservative like armor.ts/aiProfiles.ts: medals.tbl entries are mostly
 * just an identity + display bitmap, without much else worth order-checking.
 */
export const medalsSchema: TableSchema = {
  name: "medals.tbl",
  fileMatch: [/(^|[\\/])medals\.tbl$/i, /-med\.tbm$/i],
  sectionNames: ["Medals"],
  entryKeyField: "Name",
  fieldOrder: ["Name", "Bitmap", "Num Mods"],
};
