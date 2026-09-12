import { TableSchema } from "./types";
import { LOOSE_SECTION_NAME } from "../parser";

/**
 * rank.tbl / *-rnk.tbm schema.
 *
 * fieldOrder is a mechanical extraction from `scoring.cpp`'s `parse_rank_table()`:
 * `Name` -> `Alt Name` -> `Title` -> `Points` -> `Bitmap` -> `Promotion Voice Base` ->
 * `Promotion Text` (repeatable). An earlier version of this schema had `Promotion
 * Text`/`Promotion Voice Base` the wrong way around, which flagged a real, correctly-
 * ordered Between the Ashes rank.tbl as "out of order". `$Promotion Text:` is also a
 * real `F_MULTITEXT` field (terminated by `$end_multi_text`, confirmed against a real
 * file) - added to parser.ts's `MULTITEXT_FIELDS` alongside `description`/`tech
 * description`.
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
  fieldOrder: ["Name", "Alt Name", "Title", "Points", "Bitmap", "Promotion Voice Base", "Promotion Text"],
};
