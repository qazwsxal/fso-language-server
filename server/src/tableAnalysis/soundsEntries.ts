import { TableSection } from "../parser";

export type SoundSectionKind = "game" | "interface" | "flyby" | "environment";

const SECTION_KIND_BY_NAME: Record<string, SoundSectionKind> = {
  "game sounds start": "game",
  "interface sounds start": "interface",
  "flyby sounds start": "flyby",
  // Confirmed as ending in "#Sound Environments End" (fso-table-fields-reference project
  // memory); the exact opening token wasn't confirmed against source, so this is the
  // documented-pending-confirmation best guess for the Start-side name.
  "sound environments start": "environment",
};

export interface SoundEntryInfo {
  kind: SoundSectionKind;
  /** Often a numeric index string (e.g. "1") rather than a descriptive name - see sounds.ts schema. */
  name: string;
  nameLine: number;
  /** Modular-table-only sentinels (see fso-table-format): only relevant when merging .tbm layers. */
  noCreate: boolean;
  remove: boolean;
}

/**
 * Extracts per-sound-entry identity info from a parsed sounds.tbl/*-snd.tbm. sounds.tbl
 * has multiple independent named sections (see sounds.ts schema/parser.ts's
 * table-specific Start/End close-token support), each closed with its own
 * distinctly-named end token rather than a shared `#End` - entries are tagged with
 * which section (`kind`) they came from, since the same numeric index string can
 * legitimately recur across sections with unrelated meanings (e.g. "1" as both a game
 * sound and an interface sound).
 */
export function extractSoundEntries(sections: TableSection[]): SoundEntryInfo[] {
  const entries: SoundEntryInfo[] = [];

  for (const section of sections) {
    const kind = SECTION_KIND_BY_NAME[section.name.trim().toLowerCase()];
    if (!kind) {
      continue;
    }

    let current: SoundEntryInfo | null = null;
    for (const field of section.entries) {
      const key = field.key.trim().toLowerCase();

      if (field.sigil === "$" && key === "name") {
        current = { kind, name: field.value.trim(), nameLine: field.line, noCreate: false, remove: false };
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
