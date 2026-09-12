import { LOOSE_SECTION_NAME } from "../parser";
import { TableSchema } from "./types";

/**
 * intel.tbl / *-intl.tbm schema - the tech room "Intelligence Database" species/event
 * entries. This resolves a previously-unexplained mystery (see the
 * fso-nonstandard-section-grammars project memory's "Species.tbl" entry): a real file
 * with exactly this shape (`$Entry:`/`$Name:`/`$Anim:`/`$AlwaysInTechRoom:`/
 * `$Description:`) was found with no matching parser anywhere in ship.cpp/species_defs
 * parsing/missionui/hud/menuui - because the real owner is `code/menuui/techmenu.cpp`'s
 * `parse_intel_table()`, not any of those.
 *
 * Confirmed against `techmenu.cpp`:
 * - `techroom_intel_init()` loads `intel.tbl` if it exists, otherwise falls back to the
 *   legacy alias filename `species.tbl` (NOT `species_defs.tbl`, a completely different,
 *   already-supported table) - "only load one or the other". Both base filenames are
 *   matched here. The real modular suffix is `*-intl.tbm` for either base name.
 * - The `#Intel` section wrapper is entirely OPTIONAL (`optional_string("#Intel")`, not
 *   `required_string`) and the retail table has never used one; `LOOSE_SECTION_NAME` is
 *   included alongside it, mirroring rank.ts/mainhall.ts's rationale.
 * - Each entry is a bare `$Entry:` marker (no colon value) - NOT `$Name:` - immediately
 *   followed by a required `$Name:` that carries the real identity/display value, same
 *   split as mainhall.tbl's `$Main Hall` marker + `+Name:` sub-field shape.
 * - Retail closes each entry implicitly (next `$Entry:` or EOF) and the whole table has
 *   no `#End` at all in a real file, though the parser now also accepts one for modders
 *   who add it - see `isOptionallyHeaderlessTableFile()` in server.ts.
 * - `$Custom data:` uses the generic `+Val:`/`$end_custom_data` string-map shape shared
 *   with other tables (e.g. weapons.tbl) - no special parser handling needed since
 *   `+Val:` is an ordinary `+`-sigil field and `$end_custom_data` is already a generic
 *   sentinel this parser recognizes (see parser.ts's `MULTILINE_END_MARKERS`).
 */
export const intelSchema: TableSchema = {
  name: "intel.tbl",
  fileMatch: [/(^|[\\/])intel\.tbl$/i, /(^|[\\/])species\.tbl$/i, /-intl\.tbm$/i],
  sectionNames: ["Intel", LOOSE_SECTION_NAME],
  entryKeyField: "Entry",
  fields: ["Entry", "Name", "Anim", "AlwaysInTechRoom", "Description", "Custom data"],
};
