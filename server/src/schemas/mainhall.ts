import { LOOSE_SECTION_NAME } from "../parser";
import { TableSchema } from "./types";

/**
 * mainhall.tbl / *-hall.tbm schema - main hall (front-end UI) definitions. Real
 * entries carry many more nested fields (door regions, ambient sounds, etc.); this
 * schema only covers the well-documented top few, same conservative approach as the
 * other schemas here.
 *
 * Corrected after running the real, compiled extension against a real Blue Planet
 * install and ground-truthing `code/menuui/mainhallmenu.cpp`'s `parse_main_hall_table()`/
 * `parse_one_main_hall()`: this table is genuinely, unconditionally headerless (like
 * ssm.tbl - no `#Section` wrapper exists in the grammar at all, confirmed against real
 * bp-main-hall.tbm/bp2-main-hall.tbm), so `LOOSE_SECTION_NAME` is required alongside a
 * literal section name that will never actually occur, mirroring rank.ts's rationale.
 * Each entry opens with a bare `$Main Hall` marker (no colon, no value on that line) -
 * NOT `$Name:` as an earlier guess had it - with the display name coming from an
 * optional `+Name:` sub-field instead (defaulting to a numeric index string if absent).
 */
export const mainhallSchema: TableSchema = {
  name: "mainhall.tbl",
  fileMatch: [/(^|[\\/])mainhall\.tbl$/i, /-hall\.tbm$/i],
  sectionNames: ["Main Halls", LOOSE_SECTION_NAME],
  entryKeyField: "Main Hall",
  fields: ["Base mainhalls on retail defaults", "Num Resolutions", "Main Hall", "Bitmap", "Mask", "Music"],
};
