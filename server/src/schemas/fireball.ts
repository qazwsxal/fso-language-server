import { TableSchema } from "./types";

/**
 * fireball.tbl / *-fbl.tbm schema.
 *
 * Unlike most tables, fireball.tbl entries are identified by `$Bitmap:` (the effect's
 * animation filename) rather than a `$Name:` field - there's no separate display name.
 */
export const fireballSchema: TableSchema = {
  name: "fireball.tbl",
  fileMatch: [/(^|[\\/])fireball\.tbl$/i, /-fbl\.tbm$/i],
  sectionNames: ["Fireballs"],
  entryKeyField: "Bitmap",
  fieldOrder: ["Bitmap", "LOD", "Type"],
};
