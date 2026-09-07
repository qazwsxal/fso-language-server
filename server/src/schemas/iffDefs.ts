import { TableSchema } from "./types";

/**
 * iff_defs.tbl / *-iff.tbm schema.
 *
 * Confirmed against FSO's iff_defs.cpp (parse_iff_table): the section header is
 * `#IFFs` (NOT `#IFF Defs` - an earlier, incorrect guess), and per-entry field order is
 * IFF Name -> Color -> Attacks -> Flags -> Default Ship Flags -> Default Ship Flags2.
 * `+Sees <Team> As:`/`+Accessibility Sees <Team> As:`/`+Hotkey Team:` are `+`-sigil
 * sub-fields, not order-checked. A few global (not per-IFF) fields like `$Traitor IFF:`
 * precede the first entry and are simply ignored (unknown to this schema).
 */
export const iffDefsSchema: TableSchema = {
  name: "iff_defs.tbl",
  fileMatch: [/(^|[\\/])iff_defs\.tbl$/i, /-iff\.tbm$/i],
  sectionNames: ["IFFs"],
  entryKeyField: "IFF Name",
  fieldOrder: ["IFF Name", "Color", "Attacks", "Flags", "Default Ship Flags", "Default Ship Flags2"],
};
