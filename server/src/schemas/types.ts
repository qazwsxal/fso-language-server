/**
 * A field name, or a field marked `unordered` because the real parser genuinely accepts
 * it in any position relative to its siblings (confirmed for ai_profiles.tbl - see
 * aiProfiles.ts's own doc comment). An unordered field is still fully known - it's
 * recognized, it still counts toward cross-schema field ownership, and it still
 * completes - it's just never checked against its neighbors' relative order.
 */
export type SchemaField = string | { name: string; unordered: true };

export function schemaFieldName(field: SchemaField): string {
  return typeof field === "string" ? field : field.name;
}

/** Every field name a schema recognizes, regardless of sigil or `unordered` status. */
export function allFieldNames(fields: SchemaField[]): string[] {
  return fields.map(schemaFieldName);
}

/** Field names this schema's order-checking pass actually compares against each other. */
export function orderedFieldNames(fields: SchemaField[]): string[] {
  return fields.filter((f): f is string => typeof f === "string");
}

/**
 * A TableSchema describes every `$`/`+`/`@` field the real FSO parser recognizes within
 * one entry of a given table, in true parse order, so the schema validator can flag a
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
   * The complete list of every `$`/`+`/`@` field this schema recognizes, in true FSO
   * parse order, case-insensitive and matched without the sigil. This ONE list is the
   * single source of truth for three independent consumers, so a field added here is
   * automatically visible to all three instead of requiring separate lists to be kept in
   * sync by hand (a real bug this project hit once already - a `+`/`@` field added for
   * order-checking purposes silently never reached completion, since completion didn't
   * exist as a consumer yet when the field was first left out; see
   * fso_completion_coverage_and_quickfix's "fieldOrder's dual-purpose reuse" memory note):
   *   1. `schemaValidator.ts` orders `$`-sigil fields against each other by their index
   *      here via `orderedFieldNames()`. A `+`/`@` field is never order-checked (they're
   *      positionally free-form modifiers/sub-entries in practice), so its own position
   *      in this list doesn't affect correctness - it's included only so completion
   *      offers it in the right place.
   *   2. `schemaValidator.ts`'s cross-schema `knownFieldOwners` map uses every name here
   *      (via `allFieldNames()`, regardless of sigil or `unordered`) to recognize "this
   *      field belongs to a different schema" versus "genuinely unknown to any schema".
   *   3. `server.ts`'s `schemaFieldCompletions()` offers every name here (via
   *      `allFieldNames()`), in this order, whenever a `$`/`+`/`@` is typed - completion
   *      never cares about order-checking.
   * Wrap a field as `{ name, unordered: true }` when the real parser genuinely accepts it
   * in any order relative to its siblings - confirmed for ai_profiles.tbl, whose own
   * source comment says so directly (`ai_profiles.cpp`: "fill in any and all settings;
   * they're all optional and can be in any order", implemented via a retry loop that
   * re-scans for the next matching field rather than a single sequential pass). Treating
   * such a field as normally-ordered would produce false "out of order" noise for any
   * real file that (validly) uses a different order for it - worse than the
   * "unrecognized field" noise it would otherwise silence. An `unordered` field is still
   * fully known to (2) and (3), it just never gets an order index from (1).
   */
  fields: SchemaField[];
  /**
   * A field (e.g. ships.tbl's "Subsystem") that opens a nested per-block scope in which
   * field names can legitimately repeat with a different, block-local meaning (a
   * turret's own `$Flags:`/`$Armor Type:`/`$Default PBanks:`, distinct from the ship's
   * own same-named fields) - confirmed against a real Blue Planet ships.tbm where a
   * turret's `$Flags:` was flagged "out of the expected field order" every single time,
   * because the validator has no concept of nested scope and was comparing it against
   * the *ship-level* `$Flags:` field's position instead. Once this field is seen, order
   * checking stops for the remainder of the entry rather than trying to model the
   * nested schema too (which `fields` isn't shaped to express).
   */
  nestedScopeStartField?: string;
}
