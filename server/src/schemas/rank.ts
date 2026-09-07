import { TableSchema } from "./types";

/**
 * rank.tbl / *-rnk.tbm schema.
 *
 * Field order is a best-effort reading (identity/points -> display -> promotion
 * flavor text/voice), not transcribed from scoring.cpp.
 */
export const rankSchema: TableSchema = {
  name: "rank.tbl",
  fileMatch: [/(^|[\\/])rank\.tbl$/i, /-rnk\.tbm$/i],
  sectionNames: ["Ranks"],
  entryKeyField: "Name",
  fieldOrder: ["Name", "Points", "Bitmap", "Promotion Text", "Promotion Voice Base"],
};
