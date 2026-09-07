import { TableSchema } from "./types";

/**
 * music.tbl / *-mus.tbm schema - adaptive soundtrack definitions. Kept short: this
 * project has low confidence in the full field set/order beyond the identity field.
 */
export const musicSchema: TableSchema = {
  name: "music.tbl",
  fileMatch: [/(^|[\\/])music\.tbl$/i, /-mus\.tbm$/i],
  sectionNames: ["Soundtracks"],
  entryKeyField: "Name",
  fieldOrder: ["Name", "Album"],
};
