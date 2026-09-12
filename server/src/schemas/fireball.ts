import { TableSchema } from "./types";

/**
 * fireball.tbl / *-fbl.tbm schema.
 *
 * Confirmed (fso-table-fields-reference project memory, `fireballs.cpp`): the section
 * wrapper is genuinely just `#Start`/`#End` (not `#Fireballs`, an earlier incorrect
 * guess that meant this schema silently validated nothing against real files), and
 * entries are keyed by `$Name:` **or** `$Unique ID:` (`required_string_one_of`, both
 * accepted) - not `$Bitmap:`, another earlier incorrect guess. This schema's
 * entryKeyField model only supports one key field, so "Name" is used as the primary
 * (more common) form; a `$Unique ID:`-keyed entry won't be order-checked, which is a
 * known limitation of the schema shape rather than a fresh guess.
 *
 * `Unique ID` itself is real and OPTIONAL, always parsed right BEFORE `$Name:` on a
 * real entry (`fireballs.cpp`) - ordering it ahead of `Name` would only be safe for the
 * FIRST entry in a section: `validateAgainstSchema()`'s order-reset only fires on
 * `entryKeyField` ("Name"), so `$Unique ID:` on every later entry would still be compared
 * against the PREVIOUS entry's highest field index and almost always flagged "out of
 * order". Marked `unordered` instead (see `SchemaField`'s doc comment in schemas/types.ts)
 * so it's recognized (and still completes) without that risk - confirmed against a real
 * Between the Ashes bta-fbl.tbm.
 */
export const fireballSchema: TableSchema = {
  name: "fireball.tbl",
  fileMatch: [/(^|[\\/])fireball\.tbl$/i, /-fbl\.tbm$/i],
  sectionNames: ["Start"],
  entryKeyField: "Name",
  fields: [{ name: "Unique ID", unordered: true }, "Name", "LOD", "Type"],
};
