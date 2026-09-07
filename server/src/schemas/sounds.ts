import { TableSchema } from "./types";

/**
 * sounds.tbl / *-snd.tbm schema.
 *
 * Least-confident schema in this directory: sounds.tbl entries are commonly keyed by
 * a numeric sound-index string (e.g. `$Name: 1`) rather than a descriptive name, and
 * this reader hasn't confirmed the exact field set/order against gamesnd.cpp. Kept
 * deliberately minimal so it flags almost nothing rather than risking false positives
 * on a table shape this project is least sure about.
 */
export const soundsSchema: TableSchema = {
  name: "sounds.tbl",
  fileMatch: [/(^|[\\/])sounds\.tbl$/i, /-snd\.tbm$/i],
  sectionNames: ["Game Sounds"],
  entryKeyField: "Name",
  fieldOrder: ["Name", "Filename"],
};
