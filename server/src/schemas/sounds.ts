import { TableSchema } from "./types";

/**
 * sounds.tbl / *-snd.tbm schema.
 *
 * Section wrappers confirmed (fso-table-fields-reference project memory,
 * `gamesnd.cpp`): sounds.tbl has multiple independent named sections, each its own
 * distinctly-named Start/End pair - not a single `#Game Sounds`/`#End` pair (an earlier
 * guess that meant this schema matched nothing in a real file, since the parser now
 * models table-specific close tokens like `#Game Sounds End` too - see parser.ts). Field
 * set/order within each section is still not confirmed against source, so this stays
 * deliberately minimal (identity field only) to avoid false positives on a shape this
 * project is least sure about. `Template` was added after a real Blue Planet
 * Sound Environments section (`$Name:` then optional `$Template:`, gamesnd.cpp:1141-1148)
 * flagged it as unrecognized under `unknownFieldSeverity`.
 */
export const soundsSchema: TableSchema = {
  name: "sounds.tbl",
  fileMatch: [/(^|[\\/])sounds\.tbl$/i, /-snd\.tbm$/i],
  sectionNames: ["Game Sounds Start", "Interface Sounds Start", "Flyby Sounds Start", "Sound Environments Start"],
  entryKeyField: "Name",
  fieldOrder: ["Name", "Filename", "Template"],
};
