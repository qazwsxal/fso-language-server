import { TableSchema } from "./types";

/**
 * objecttypes.tbl / *-obt.tbm schema.
 *
 * Confirmed against a real bp2-obt.tbm: this table's actual section headers are
 * `#Target Priorities` and `#Ship Types` (NOT `#Object Types` - an earlier incorrect
 * guess, which meant this schema silently validated nothing at all against real files).
 * The two sections have quite different field sets (target-priority entries use
 * `+Weapon Class Flags:`/`+Object Type:`, not order-checked here), so this schema only
 * covers `#Ship Types` entries in any real depth.
 *
 * fieldOrder is a mechanical, in-source-order extraction of `#Ship Types` entry parsing
 * (`ship.cpp`'s ship-type parser, ~line 5850-6025 - objecttypes.tbl has no dedicated
 * .cpp of its own). `Target Priority Groups`/`Explosion Animations`/`Skip Death Roll
 * Percent Chance`/`Vaporize Percent Chance` are genuinely shared with ships.tbl under
 * the identical name (reused at the ship-type level here) - without them in THIS
 * schema's own list too, every `#Ship Types` entry using one got a false "possibly
 * misplaced" warning (confirmed against real Blue Planet and Between the Ashes
 * installs). `$AI:`'s many `+`-sigil sub-fields aren't order-checked.
 */
export const objectTypesSchema: TableSchema = {
  name: "objecttypes.tbl",
  fileMatch: [/(^|[\\/])objecttypes\.tbl$/i, /-obt\.tbm$/i],
  sectionNames: ["Target Priorities", "Ship Types"],
  entryKeyField: "Name",
  fieldOrder: [
    "Name",
    "Target Priority Groups",
    "Counts for Alone",
    "Praise Destruction",
    "On Hotkey list",
    "Target as Threat",
    "Show Attack Direction",
    "Scannable",
    "Targetable as unscanned",
    "Scannable by default",
    "Warp Pushes",
    "Warp Pushable",
    "Turrets prioritize ship target",
    "Max Debris Speed",
    "FF Multiplier",
    "EMP Multiplier",
    "Warp Sound Range Multiplier",
    "Beams Easily Hit",
    "Protected on cripple",
    "No Huge Beam Impact Effects",
    "Don't display class in briefing",
    "Fog",
    "AI",
    "Explosion Animations",
    "Skip Death Roll Percent Chance",
    "Vaporize Percent Chance",
  ],
};
