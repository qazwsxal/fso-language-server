import { ParseDiagnostic, Severity, TableSection } from "./parser";
import { TableSchema, allSchemas, allFieldNames, orderedFieldNames } from "./schemas";

/** How unrecognized `$Field:` keys (not known to ANY schema) should be reported. "off" keeps the original silent behavior. */
export type UnknownFieldSeverity = "off" | Severity;

/**
 * Maps a normalized field key to every schema name that lists it in its own
 * `fieldOrder` - built once from all schemas so validateAgainstSchema() can tell "unknown
 * to this table" apart from "known, but that's a different table's field" without each
 * schema needing to know about its siblings. A field owned by 2+ schemas (e.g. "Name",
 * "Flags", "Score" - genuinely common across tables) is deliberately never flagged as
 * misplaced: with more than one legitimate owner, guessing which one is "wrong" would be
 * pure noise.
 */
const knownFieldOwners: Map<string, Set<string>> = (() => {
  const owners = new Map<string, Set<string>>();
  for (const schema of allSchemas) {
    for (const key of new Set(allFieldNames(schema.fields).map(normalize))) {
      const set = owners.get(key) ?? new Set<string>();
      set.add(schema.name);
      owners.set(key, set);
    }
  }
  return owners;
})();

/**
 * Checks that recognized `$Field` keys within each entry of a schema-governed section
 * appear in the schema's documented relative order. Entries are delimited by the
 * schema's `entryKeyField` (e.g. a new `$Name:` starts a new ship).
 *
 * A field unrecognized by the CURRENT schema is handled one of two ways: if it's a real
 * field belonging to exactly one OTHER schema (e.g. a weapons.tbl field pasted into
 * ships.tbl), that's a higher-confidence mistake and always reported as a warning,
 * regardless of `unknownFieldSeverity`. Otherwise (genuinely unrecognized by every
 * schema this project knows about) it's reported at `unknownFieldSeverity`, which
 * defaults to "off" (the original silent behavior) since the field lists here are
 * best-effort rather than transcribed from the real parser source, and SCP adds new
 * fields to tables over time - a field this schema doesn't know about yet is not itself
 * necessarily a mistake.
 */
export function validateAgainstSchema(
  sections: TableSection[],
  schema: TableSchema,
  unknownFieldSeverity: UnknownFieldSeverity = "off",
): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  const orderIndex = new Map<string, number>();
  orderedFieldNames(schema.fields).forEach((key, i) => orderIndex.set(normalize(key), i));
  const unorderedKeys = new Set(
    schema.fields.filter((f): f is { name: string; unordered: true } => typeof f !== "string").map((f) => normalize(f.name)),
  );

  for (const section of sections) {
    if (!schema.sectionNames.some((n) => normalize(n) === normalize(section.name))) {
      continue;
    }

    // Defense-in-depth: if the schema's entryKeyField never actually matches anything in
    // this section, per-entry order tracking below would never reset between entries and
    // could flag a field as "out of order" relative to a completely different entry's
    // leftover state - a real failure mode this project hit once already (a wrong
    // `entryKeyField` guess for species_defs.tbl). Skip this section entirely rather than
    // risk emitting misattributed diagnostics when the schema clearly doesn't match reality.
    const entryKeyFieldSeen = section.entries.some(
      (e) => e.sigil === "$" && normalize(e.key) === normalize(schema.entryKeyField),
    );
    if (!entryKeyFieldSeen) {
      continue;
    }

    let lastIndex = -1;
    let lastKey = "";
    let currentEntryName = "(entry)";
    let inNestedScope = false;
    const nestedScopeKey = schema.nestedScopeStartField ? normalize(schema.nestedScopeStartField) : null;

    for (const entry of section.entries) {
      if (entry.sigil === "$" && normalize(entry.key) === normalize(schema.entryKeyField)) {
        // A new entry starts: reset order tracking.
        lastIndex = -1;
        lastKey = "";
        currentEntryName = entry.value.trim() || "(unnamed)";
        inNestedScope = false;
      }

      if (entry.sigil !== "$") {
        // +Subfields are positionally free-form modifiers of the preceding $Field; not order-checked.
        continue;
      }

      if (inNestedScope) {
        // Past the entry's nested-scope boundary (e.g. a ship's first $Subsystem:) -
        // field names here can legitimately repeat with a block-local meaning, so
        // there's nothing this flat field-order list can correctly check anymore.
        continue;
      }

      if (nestedScopeKey && normalize(entry.key) === nestedScopeKey) {
        inNestedScope = true;
      }

      if (unorderedKeys.has(normalize(entry.key))) {
        // Recognized by this schema, but deliberately not order-checked (see
        // TableSchema.unorderedFields's doc comment) - not flagged either way, and
        // doesn't touch lastIndex/lastKey since it carries no position of its own.
        continue;
      }

      const idx = orderIndex.get(normalize(entry.key));
      if (idx === undefined) {
        // Note: owners.has(schema.name) can never be true here - if it were, idx above
        // wouldn't be undefined in the first place (owners is derived from the same
        // fieldOrder lists as orderIndex).
        const owners = knownFieldOwners.get(normalize(entry.key));
        if (owners && owners.size === 1) {
          diagnostics.push({
            line: entry.line,
            startCol: 0,
            endCol: entry.raw.length,
            message: `"$${entry.key}" is a ${[...owners][0]} field, not recognized in ${schema.name} - possibly misplaced (entry "${currentEntryName}")`,
            severity: "warning",
          });
        } else if (!owners && unknownFieldSeverity !== "off") {
          diagnostics.push({
            line: entry.line,
            startCol: 0,
            endCol: entry.raw.length,
            message: `"$${entry.key}" is not a field ${schema.name} recognizes (entry "${currentEntryName}")`,
            severity: unknownFieldSeverity,
          });
        }
        // Not order-checked either way.
        continue;
      }

      if (idx < lastIndex) {
        diagnostics.push({
          line: entry.line,
          startCol: 0,
          endCol: entry.raw.length,
          message: `"$${entry.key}" is out of the expected field order for ${schema.name} (expected at/after "$${lastKey}") in entry "${currentEntryName}"`,
          severity: "warning",
        });
        // Don't update lastIndex/lastKey on an out-of-order field, so a single misplaced
        // field doesn't cascade into flagging every subsequent, correctly-ordered field.
        continue;
      }

      lastIndex = idx;
      lastKey = entry.key;
    }
  }

  return diagnostics;
}

function normalize(key: string): string {
  return key.trim().toLowerCase();
}
