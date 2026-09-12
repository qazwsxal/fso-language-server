import { TableSchema } from "./types";

/**
 * medals.tbl / *-mdl.tbm schema.
 *
 * Modular suffix confirmed as `-mdl.tbm`, NOT `-med.tbm` (an earlier guess) - live-verified
 * against `code/stats/medals.cpp`: `parse_modular_table("*-mdl.tbm", parse_medals_table)`.
 * The wrong suffix meant listMatchingFiles() would never find a single real medals.tbl
 * .tbm across any real mod, silently merging nothing.
 *
 * fieldOrder extended (previously just `Name`/`Bitmap`/`Num Mods`) after a real Between
 * the Ashes medals.tbl (a "badge" medal using the `+Num Kills:` kill-count block) got
 * false "rank.tbl field, not recognized in medals.tbl - possibly misplaced" warnings on
 * `$Promotion Text:` - it's a genuine `medals.cpp` field too, real (if unusually) nested
 * one level under `+Num Kills:`. `$Wavefile 1:`/`$Wavefile 2:`/`$Wavefile Base:`/
 * `$Promotion Text:` (repeatable, `F_MULTITEXT` - see parser.ts's `MULTITEXT_FIELDS`)
 * only ever appear after `+Num Kills:`, but `+`-sigil fields are never order-checked, so
 * that nesting doesn't need its own scope tracking here.
 */
export const medalsSchema: TableSchema = {
  name: "medals.tbl",
  fileMatch: [/(^|[\\/])medals\.tbl$/i, /-mdl\.tbm$/i],
  sectionNames: ["Medals"],
  entryKeyField: "Name",
  fieldOrder: [
    "Name",
    "Alt Name",
    "Bitmap",
    "Num mods",
    "Wavefile 1",
    "Wavefile 2",
    "Wavefile Base",
    "Promotion Text",
  ],
};
