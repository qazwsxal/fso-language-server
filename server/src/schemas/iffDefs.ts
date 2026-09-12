import { TableSchema } from "./types";

/**
 * iff_defs.tbl / *-iff.tbm schema.
 *
 * Confirmed against FSO's iff_defs.cpp (parse_iff_table): the section header is
 * `#IFFs` (NOT `#IFF Defs` - an earlier, incorrect guess), and per-entry field order is
 * IFF Name -> Color -> Accessibility Color -> Attacks -> Flags -> Default Ship Flags ->
 * Default Ship Flags2. `+Sees <Team> As:`/`+Accessibility Sees <Team> As:`/`+Hotkey
 * Team:` are `+`-sigil sub-fields, not order-checked. `$Traitor IFF:`/`$Accessibility
 * Supported:` are global (not per-IFF) fields that precede the first entry, in that
 * order - added to the front of `fields` after real Blue Planet/Between the Ashes
 * iff_defs.tbl files flagged them as unrecognized under `unknownFieldSeverity`.
 */
export const iffDefsSchema: TableSchema = {
  name: "iff_defs.tbl",
  fileMatch: [/(^|[\\/])iff_defs\.tbl$/i, /-iff\.tbm$/i],
  sectionNames: ["IFFs"],
  entryKeyField: "IFF Name",
  fields: [
    "Traitor IFF",
    "Accessibility Supported",
    "IFF Name",
    "Color",
    "Accessibility Color",
    "Attacks",
    "Flags",
    "Default Ship Flags",
    "Default Ship Flags2",
  ],
};
