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
 * one field both share - `$Name:` - plus `Target Priority Groups`, added after running
 * the real, compiled extension against a real Blue Planet install: it's genuinely
 * shared with ships.tbl under the identical name (see shipEntries.ts) - reused at the
 * ship-type level here - so without it in THIS schema's own list too, every `#Ship
 * Types` entry using it got a false "possibly misplaced" warning.
 */
export const objectTypesSchema: TableSchema = {
  name: "objecttypes.tbl",
  fileMatch: [/(^|[\\/])objecttypes\.tbl$/i, /-obt\.tbm$/i],
  sectionNames: ["Target Priorities", "Ship Types"],
  entryKeyField: "Name",
  fieldOrder: ["Name", "Target Priority Groups", "Turrets prioritize ship target"],
};
