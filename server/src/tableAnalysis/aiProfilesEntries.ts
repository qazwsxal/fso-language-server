import { TableSection } from "../parser";

export interface AiProfileEntryInfo {
  name: string;
  nameLine: number;
  /** Modular-table-only sentinels (see fso-table-format): only relevant when merging .tbm layers. ai_profiles.tbl is confirmed XMT, so +nocreate is genuinely supported here. */
  noCreate: boolean;
  remove: boolean;
}

/**
 * Extracts per-profile name info from a parsed ai_profiles.tbl/*-aip.tbm.
 *
 * Entry key is `$Profile Name:`, NOT `$Name:` (confirmed - fso-table-fields-reference
 * project memory, `ai_profiles.cpp`) - the one table in this catalog that differs from
 * every other table's `$Name:` convention. See aiProfiles.ts schema.
 */
export function extractAiProfileEntries(sections: TableSection[]): AiProfileEntryInfo[] {
  const entries: AiProfileEntryInfo[] = [];
  let current: AiProfileEntryInfo | null = null;

  for (const section of sections) {
    if (section.name.trim().toLowerCase() !== "ai profiles") {
      continue;
    }

    for (const field of section.entries) {
      const key = field.key.trim().toLowerCase();

      if (field.sigil === "$" && key === "profile name") {
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
