import { TableSection } from "../parser";

export interface AiClassEntryInfo {
  name: string;
  nameLine: number;
  /** Modular-table-only sentinels (see fso-table-format): only relevant when merging .tbm layers. */
  noCreate: boolean;
  remove: boolean;
}

/** Extracts per-AI-class name info from a parsed ai.tbl/*-ai.tbm (see aiClasses.ts schema). */
export function extractAiClassEntries(sections: TableSection[]): AiClassEntryInfo[] {
  const entries: AiClassEntryInfo[] = [];
  let current: AiClassEntryInfo | null = null;

  for (const section of sections) {
    if (section.name.trim().toLowerCase() !== "ai classes") {
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
