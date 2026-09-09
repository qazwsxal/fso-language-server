import { TableSchema } from "./types";
import { shipsSchema } from "./ships";
import { weaponsSchema } from "./weapons";
import { speciesDefsSchema } from "./speciesDefs";
import { armorSchema } from "./armor";
import { aiProfilesSchema } from "./aiProfiles";
import { iffDefsSchema } from "./iffDefs";
import { fireballSchema } from "./fireball";
import { asteroidSchema } from "./asteroid";
import { medalsSchema } from "./medals";
import { rankSchema } from "./rank";
import { soundsSchema } from "./sounds";
import { aiClassesSchema } from "./aiClasses";
import { objectTypesSchema } from "./objectTypes";
import { musicSchema } from "./music";
import { hudGaugesSchema } from "./hudGauges";
import { cutscenesSchema } from "./cutscenes";
import { mainhallSchema } from "./mainhall";

/**
 * Not covered: strings.tbl/tstrings.tbl, autopilot.tbl, and game_settings.tbl. Their
 * real shape is a flat block of numbered/global settings rather than a list of
 * `$Name:`-keyed entries, which doesn't fit the entryKeyField-based TableSchema model
 * this validator is built around - forcing a fit would mean guessing at a shape this
 * project has no real confidence in, rather than skipping it honestly.
 */
const allSchemas: TableSchema[] = [
  shipsSchema,
  weaponsSchema,
  speciesDefsSchema,
  armorSchema,
  aiProfilesSchema,
  iffDefsSchema,
  fireballSchema,
  asteroidSchema,
  medalsSchema,
  rankSchema,
  soundsSchema,
  aiClassesSchema,
  objectTypesSchema,
  musicSchema,
  hudGaugesSchema,
  cutscenesSchema,
  mainhallSchema,
];

/** Picks the schema (if any) whose fileMatch patterns match the given document file name/path. */
export function findSchemaForFile(fileNameOrUri: string): TableSchema | null {
  for (const schema of allSchemas) {
    if (schema.fileMatch.some((re) => re.test(fileNameOrUri))) {
      return schema;
    }
  }
  return null;
}

export { allSchemas };
export { TableSchema } from "./types";
export { shipsSchema } from "./ships";
export { weaponsSchema } from "./weapons";
export { speciesDefsSchema } from "./speciesDefs";
export { armorSchema } from "./armor";
export { aiProfilesSchema } from "./aiProfiles";
export { iffDefsSchema } from "./iffDefs";
export { fireballSchema } from "./fireball";
export { asteroidSchema } from "./asteroid";
export { medalsSchema } from "./medals";
export { rankSchema } from "./rank";
export { soundsSchema } from "./sounds";
export { aiClassesSchema } from "./aiClasses";
export { objectTypesSchema } from "./objectTypes";
export { musicSchema } from "./music";
export { hudGaugesSchema } from "./hudGauges";
export { cutscenesSchema } from "./cutscenes";
export { mainhallSchema } from "./mainhall";
