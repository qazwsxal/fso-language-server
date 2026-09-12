import { TableSchema } from "./types";

/**
 * armor.tbl / *-amr.tbm schema.
 *
 * Confirmed against a real armor.tbm: `$Name:` is followed by a variable number of
 * repeatable `$Damage Type: <name>` entries (each with nested `+Calculation:`/`+Value:`/
 * `+Weapon Piercing ...:` sub-fields that this project doesn't order-check), so there
 * isn't much of an order to get wrong - kept intentionally short.
 */
export const armorSchema: TableSchema = {
  name: "armor.tbl",
  fileMatch: [/(^|[\\/])armor\.tbl$/i, /-amr\.tbm$/i],
  sectionNames: ["Armor Type"],
  entryKeyField: "Name",
  fields: ["Name", "Damage Type"],
};
