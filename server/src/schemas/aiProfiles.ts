import { TableSchema } from "./types";

/**
 * ai_profiles.tbl / *-aip.tbm schema.
 *
 * ai_profiles.tbl is one of FSO's hardcoded-fallback tables (see fso-table-format
 * project memory). Unlike ships.tbl, most of its fields are independent numeric tuning
 * knobs with no real interdependency on each other's position, so this schema is
 * deliberately short - just the identity field plus a handful of identity-adjacent
 * fields confidently known to come early - rather than guessing at a long, mostly
 * order-irrelevant field list and risking false-positive order warnings.
 *
 * Entry key is confirmed (fso-table-fields-reference project memory, `ai_profiles.cpp`)
 * to be `$Profile Name:`, NOT `$Name:` - the one table in this catalog that differs from
 * every other table's `$Name:` convention. An earlier version of this schema used
 * "Name", which meant the order validator's `entryKeyFieldSeen` guard silently skipped
 * every real ai_profiles.tbl entirely (never matched, never flagged anything).
 */
export const aiProfilesSchema: TableSchema = {
  name: "ai_profiles.tbl",
  fileMatch: [/(^|[\\/])ai_profiles\.tbl$/i, /-aip\.tbm$/i],
  sectionNames: ["AI Profiles"],
  entryKeyField: "Profile Name",
  fieldOrder: ["Profile Name", "Description"],
};
