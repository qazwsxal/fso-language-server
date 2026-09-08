import { TableSection, LOOSE_SECTION_NAME } from "../parser";

export interface RankEntryInfo {
  name: string;
  nameLine: number;
  /** Modular-table-only sentinels (see fso-table-format): only relevant when merging .tbm layers. */
  noCreate: boolean;
  remove: boolean;
}

/**
 * Extracts per-rank name info from a parsed rank.tbl/*-rnk.tbm (see rank.ts schema).
 *
 * rank.tbl is confirmed (fso-table-fields-reference project memory, `scoring.cpp`) to
 * have NO hard-required section header at all - the real parser only optionally skips a
 * legacy `[RANK NAMES]` bracket header or a `#Ranks` header via `check_for_string()`/
 * `skip_to_string()` (neither is `required_string()`), then reads `$Name:` entries
 * straight through to `#End`. Critically, the *engine* never identifies "this is the
 * rank table" from that header either - `parse_rank_table()` is called explicitly on the
 * fixed filename `rank.tbl` (and `*-rnk.tbm` via `parse_modular_table()`), the same
 * filename-based dispatch every other table uses. Since the caller here (see
 * mergedRankTable.ts) already resolved this file by that same filename convention before
 * ever calling parseTable() on it, this extractor doesn't need an in-file marker either
 * - it reads both `parser.ts`'s synthetic no-header catch-all (LOOSE_SECTION_NAME, for
 * files with no header or the legacy `[RANK NAMES]` bracket form - which parser.ts
 * silently skips over rather than treating as a section) and an explicit `#Ranks`
 * section, whichever the file happens to use.
 */
export function extractRankEntries(sections: TableSection[]): RankEntryInfo[] {
  const entries: RankEntryInfo[] = [];
  let current: RankEntryInfo | null = null;

  for (const section of sections) {
    const name = section.name.trim().toLowerCase();
    if (name !== "ranks" && section.name !== LOOSE_SECTION_NAME) {
      continue;
    }

    for (const field of section.entries) {
      const key = field.key.trim().toLowerCase();

      if (field.sigil === "$" && key === "name") {
        current = { name: field.value.trim(), nameLine: field.line, noCreate: false, remove: false };
        entries.push(current);
        continue;
      }
      if (!current) {
        continue;
      }

      if (field.sigil === "+") {
        if (key === "nocreate") {
          current.noCreate = true;
        } else if (key === "remove") {
          current.remove = true;
        }
      }
    }
  }

  return entries;
}
