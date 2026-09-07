import { TableSchema } from "./types";

/**
 * ai.tbl / *-ai.tbm schema - base AI skill-level class definitions (Trainee, Rookie,
 * Veteran, ...), distinct from the tunable ai_profiles.tbl. Field order is a
 * best-effort reading (identity -> the well-known per-skill-level numeric stat
 * arrays), not transcribed from aicode.cpp.
 */
export const aiClassesSchema: TableSchema = {
  name: "ai.tbl",
  fileMatch: [/(^|[\\/])ai\.tbl$/i, /-ai\.tbm$/i],
  sectionNames: ["AI Classes"],
  entryKeyField: "Name",
  fieldOrder: ["Name", "Accuracy", "Evasion", "Courage", "Patience"],
};
