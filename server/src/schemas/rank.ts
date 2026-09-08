import { TableSchema } from "./types";
import { LOOSE_SECTION_NAME } from "../parser";

/**
 * rank.tbl / *-rnk.tbm schema.
 *
 * Field order is a best-effort reading (identity/points -> display -> promotion
 * flavor text/voice), not transcribed from scoring.cpp.
 *
 * rank.tbl is confirmed to have no hard-required section header (see rankEntries.ts) -
 * `LOOSE_SECTION_NAME` is included alongside the optional `#Ranks` header so order
 * validation still runs against a real-world headerless rank.tbl/-rnk.tbm, not just the
 * (less common) explicitly-headered form.
 */
export const rankSchema: TableSchema = {
  name: "rank.tbl",
  fileMatch: [/(^|[\\/])rank\.tbl$/i, /-rnk\.tbm$/i],
  sectionNames: ["Ranks", LOOSE_SECTION_NAME],
  entryKeyField: "Name",
  fieldOrder: ["Name", "Points", "Bitmap", "Promotion Text", "Promotion Voice Base"],
};
