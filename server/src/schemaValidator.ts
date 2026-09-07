import { ParseDiagnostic, TableSection } from "./parser";
import { TableSchema } from "./schemas";

/**
 * Checks that recognized `$Field` keys within each entry of a schema-governed section
 * appear in the schema's documented relative order. Entries are delimited by the
 * schema's `entryKeyField` (e.g. a new `$Name:` starts a new ship). Unknown fields are
 * silently ignored (see the caveat in schemas/types.ts) — only order among fields the
 * schema actually knows about is checked, and only ever as a warning, since the field
 * lists here are best-effort rather than transcribed from the real parser source.
 */
export function validateAgainstSchema(sections: TableSection[], schema: TableSchema): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  const orderIndex = new Map<string, number>();
  schema.fieldOrder.forEach((key, i) => orderIndex.set(normalize(key), i));

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

    for (const entry of section.entries) {
      if (entry.sigil === "$" && normalize(entry.key) === normalize(schema.entryKeyField)) {
        // A new entry starts: reset order tracking.
        lastIndex = -1;
        lastKey = "";
        currentEntryName = entry.value.trim() || "(unnamed)";
      }

      if (entry.sigil !== "$") {
        // +Subfields are positionally free-form modifiers of the preceding $Field; not order-checked.
        continue;
      }

      const idx = orderIndex.get(normalize(entry.key));
      if (idx === undefined) {
        // Unknown to this schema - not an error, just not order-checked.
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
