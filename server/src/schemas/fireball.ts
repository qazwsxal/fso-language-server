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
 */
export const fireballSchema: TableSchema = {
  name: "fireball.tbl",
  fileMatch: [/(^|[\\/])fireball\.tbl$/i, /-fbl\.tbm$/i],
  sectionNames: ["Start"],
  entryKeyField: "Name",
  fieldOrder: ["Name", "LOD", "Type"],
};
