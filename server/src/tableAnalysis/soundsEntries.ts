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
 * Splits a raw `$Name:` field value into its `+nocreate`/`+remove` modifiers (if any)
 * and the actual identity token. Confirmed against real files (retail Root_fs2.vp's
 * sounds.tbl and Blue Planet's bp-snd.tbm/MediaVPs' mv_effects-snd.tbm) that, unlike most
 * other tables, sounds.tbl packs everything for one entry onto the `$Name:` line itself -
 * `+nocreate` (when present) and the identity token, immediately followed by the
 * filename/volume/3D-sound parameters with no field boundary between them, e.g.
 * `$Name:	92	m_angel.wav,		0, 0.80, 1,  50, 400` (identity "92") or
 * `$Name:	+nocreate 	4	ship_p,			0, 0.30, 0` (noCreate, identity "4"). The identity
 * itself is never comma-suffixed (only the filename token after it is), so splitting on
 * the first run of whitespace is enough to isolate it from the rest of the line.
 */
function parseNameValue(rawValue: string): { noCreate: boolean; remove: boolean; identity: string } {
  let rest = rawValue.trim();
  let noCreate = false;
  let remove = false;

  let modifier: RegExpExecArray | null;
  while ((modifier = /^(\+nocreate|\+remove)\b\s*/i.exec(rest))) {
    if (/nocreate/i.test(modifier[1])) {
      noCreate = true;
    } else {
      remove = true;
    }
    rest = rest.slice(modifier[0].length);
  }

  const identity = /^([^\s,]+)/.exec(rest)?.[1] ?? "";
  return { noCreate, remove, identity };
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
        const { noCreate, remove, identity } = parseNameValue(field.value);
        current = { kind, name: identity, nameLine: field.line, noCreate, remove };
        entries.push(current);
        continue;
      }
      if (!current) {
        continue;
      }

      // Belt-and-suspenders: every real sample has +nocreate/+remove packed onto the
      // $Name: line itself (handled by parseNameValue above), but fall back to treating
      // them as their own +field line too, in case some file does it the other way.
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
