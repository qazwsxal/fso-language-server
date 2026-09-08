import { TableSchema } from "./types";

/**
 * ai.tbl / *-aic.tbm schema - base AI skill-level class definitions (Trainee, Rookie,
 * Veteran, ...), distinct from the tunable ai_profiles.tbl. Field order is a
 * best-effort reading (identity -> the well-known per-skill-level numeric stat
 * arrays), not transcribed from aicode.cpp.
 *
 * Modular suffix confirmed as `-aic.tbm`, NOT `-ai.tbm` (an earlier guess) - live-verified
 * against `code/ai/aicode.cpp`'s `ai_init()`: `parse_modular_table("*-aic.tbm",
 * parse_aitbl)`. The wrong suffix meant listMatchingFiles() would never find a single
 * real ai.tbl .tbm across any real mod, silently merging nothing.
 */
export const aiClassesSchema: TableSchema = {
  name: "ai.tbl",
  fileMatch: [/(^|[\\/])ai\.tbl$/i, /-aic\.tbm$/i],
  sectionNames: ["AI Classes"],
  entryKeyField: "Name",
  fieldOrder: ["Name", "Accuracy", "Evasion", "Courage", "Patience"],
};
