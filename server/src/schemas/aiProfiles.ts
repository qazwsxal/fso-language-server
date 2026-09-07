import { TableSchema } from "./types";

/**
 * ai_profiles.tbl / *-aip.tbm schema.
 *
 * ai_profiles.tbl is one of FSO's hardcoded-fallback tables (see fso-table-format
 * project memory). Unlike ships.tbl, most of its fields are independent numeric tuning
 * knobs with no real interdependency on each other's position, so this schema is
 * deliberately short - just `$Name:` plus a handful of identity-adjacent fields that
 * are confidently known to come early - rather than guessing at a long, mostly
 * order-irrelevant field list and risking false-positive order warnings.
 */
export const aiProfilesSchema: TableSchema = {
  name: "ai_profiles.tbl",
  fileMatch: [/(^|[\\/])ai_profiles\.tbl$/i, /-aip\.tbm$/i],
  sectionNames: ["AI Profiles"],
  entryKeyField: "Name",
  fieldOrder: ["Name", "Description"],
};
