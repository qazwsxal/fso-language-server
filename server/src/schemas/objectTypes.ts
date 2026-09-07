import { TableSchema } from "./types";

/**
 * objecttypes.tbl / *-obt.tbm schema.
 *
 * Confirmed against a real bp2-obt.tbm: this table's actual section headers are
 * `#Target Priorities` and `#Ship Types` (NOT `#Object Types` - an earlier incorrect
 * guess, which meant this schema silently validated nothing at all against real files).
 * The two sections have quite different field sets (target-priority entries use
 * `+Weapon Class Flags:`/`+Object Type:`; ship-type entries use `$Target Priority
 * Groups:`/`$Turrets prioritize ship target:`), so this schema only order-checks the
 * one field both share - `$Name:` - rather than guessing at either section's full
 * field list.
 */
export const objectTypesSchema: TableSchema = {
  name: "objecttypes.tbl",
  fileMatch: [/(^|[\\/])objecttypes\.tbl$/i, /-obt\.tbm$/i],
  sectionNames: ["Target Priorities", "Ship Types"],
  entryKeyField: "Name",
  fieldOrder: ["Name"],
};
