/**
 * A TableSchema describes the *canonical relative field order* the real FSO parser
 * expects within one entry of a given table, so the schema validator can flag a
 * `$Field`/`+Subfield` that appears before a field it should follow.
 *
 * Field lists here are best-effort, assembled from Hard Light wiki documentation and
 * community knowledge of the FSO table grammar (see the fso-table-format project
 * memory) — they are NOT transcribed from FSO's parselo.cpp/ship.cpp source, so they
 * should be treated as a starting point to refine against real retail table files and
 * the actual parser source, not as ground truth. Unknown fields are deliberately never
 * treated as errors (only order among *recognized* fields is checked), since SCP adds
 * new fields to tables over time and a field this schema doesn't know about yet is not
 * itself a mistake.
 */
export interface TableSchema {
  /** Human-readable name, e.g. "ships.tbl". */
  name: string;
  /** Matches the base table and its modular-table siblings, e.g. /^ships\.tbl$/i, /-shp\.tbm$/i. */
  fileMatch: RegExp[];
  /** Section names (as written after '#', case-insensitive) whose entries this schema governs. */
  sectionNames: string[];
  /**
   * The field that starts a new entry within a section (almost always "Name").
   * Every field between one occurrence of this key and the next belongs to the same entry.
   */
  entryKeyField: string;
  /**
   * Canonical relative order of top-level `$Field` keys within one entry, case-insensitive,
   * matched without the sigil. `+Subfield` entries are not order-checked against this list
   * (they're positionally free-form modifiers/sub-entries in practice) but are still grouped
   * under the preceding `$Field` for informational purposes.
   */
  fieldOrder: string[];
  /**
   * A field (e.g. ships.tbl's "Subsystem") that opens a nested per-block scope in which
   * field names can legitimately repeat with a different, block-local meaning (a
   * turret's own `$Flags:`/`$Armor Type:`/`$Default PBanks:`, distinct from the ship's
   * own same-named fields) - confirmed against a real Blue Planet ships.tbm where a
   * turret's `$Flags:` was flagged "out of the expected field order" every single time,
   * because the validator has no concept of nested scope and was comparing it against
   * the *ship-level* `$Flags:` field's position instead. Once this field is seen, order
   * checking stops for the remainder of the entry rather than trying to model the
   * nested schema too (which fieldOrder isn't shaped to express).
   */
  nestedScopeStartField?: string;
}
