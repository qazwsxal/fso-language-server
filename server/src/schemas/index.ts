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
import { cutscenesSchema } from "./cutscenes";
import { mainhallSchema } from "./mainhall";
import { intelSchema } from "./intel";
import { curvesSchema } from "./curves";

/**
 * Not covered: strings.tbl/tstrings.tbl, autopilot.tbl, and game_settings.tbl. Their
 * real shape is a flat block of numbered/global settings rather than a list of
 * `$Name:`-keyed entries, which doesn't fit the entryKeyField-based TableSchema model
 * this validator is built around - forcing a fit would mean guessing at a shape this
 * project has no real confidence in, rather than skipping it honestly. Confirmed
 * directly for game_settings.tbl against `code/mod_table/mod_table.cpp`'s
 * `parse_mod_table()`: it's a flat `while (!check_for_string("#END"))` loop over
 * independent optional `$Field:` settings (explicitly "allow[ed] to be in any order,
 * just as in parse_ai_profiles_tbl" per its own source comment), not a repeating
 * `$Name:`-keyed entry list.
 *
 * Also not covered: hud_gauges.tbl/`*-hdg.tbm`. A schema for it existed briefly
 * (`hudGauges.ts`) but was removed after ground-truthing against
 * `code/hud/hudparse.cpp`'s `parse_hud_gauges_tbl()` and real Between the Ashes/Blue
 * Planet `*-hdg.tbm` files showed it was dead on every axis: the real section is
 * `#Gauge Config`, not the schema's `#Gauges`; and every per-gauge field
 * (`Gauge Type:`, `Name:`, `Text:`, `Position:`, `Font:`, ...) is read via a bare,
 * sigil-less `optional_string("Gauge Type:")`/`required_string("Gauge Type:")` call, so
 * none of them can ever satisfy `validateAgainstSchema()`'s `entry.sigil === "$"`
 * requirement for `entryKeyField` - this project already has a dedicated
 * `allowBareKeyValueLines` parser option specifically because this table's fields have
 * no sigil at all. The schema's `fieldOrder` was also actively wrong for completion
 * (offering `$Gauge Type:`/`$Position:`/`$Font:` when real files never use a `$` there).
 * There is no repeating `$`-sigil field anywhere in hud_gauges.tbl's grammar, so no
 * TableSchema can represent it as currently designed.
 *
 * scpui.tbl/`*-ui.tbm`: zero references anywhere in this FSO C++ source tree (grepped
 * for the file name and its real section names - `#Settings`, `#State Replacement`,
 * `#Background Replacement`, `#Briefing Stage Background Replacement`,
 * `#Medal Placements` - across the whole tree, no hits). It's parsed entirely by
 * SCPUI's own separate Lua codebase, not by this engine, so no FSO-source-grounded
 * schema is possible here.
 *
 * pixels.tbl: also zero references anywhere in this FSO C++ source tree - reconfirmed
 * this session.
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
  cutscenesSchema,
  mainhallSchema,
  intelSchema,
  curvesSchema,
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
export { cutscenesSchema } from "./cutscenes";
export { mainhallSchema } from "./mainhall";
export { intelSchema } from "./intel";
export { curvesSchema } from "./curves";
