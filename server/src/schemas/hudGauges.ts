import { TableSchema } from "./types";

/**
 * hud_gauges.tbl / *-hdg.tbm schema.
 *
 * Unlike most tables, hud_gauges.tbl entries are identified by `$Gauge Type:` rather
 * than a `$Name:` field. Kept short - this project has low confidence in the full
 * per-gauge-type field set/order beyond identity and basic placement/font fields.
 */
export const hudGaugesSchema: TableSchema = {
  name: "hud_gauges.tbl",
  fileMatch: [/(^|[\\/])hud_gauges\.tbl$/i, /-hdg\.tbm$/i],
  sectionNames: ["Gauges"],
  entryKeyField: "Gauge Type",
  fieldOrder: ["Gauge Type", "Position", "Font"],
};
