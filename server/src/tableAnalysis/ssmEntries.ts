import { TableSection, LOOSE_SECTION_NAME } from "../parser";

export interface SsmEntryInfo {
  name: string;
  nameLine: number;
  /** Modular-table-only sentinel (see fso-table-format) - only relevant when merging .tbm layers. Confirmed against code/hud/hudartillery.cpp's `parse_ssm()`: `+nocreate` is honored, but there is no `+remove` at all for this table. */
  noCreate: boolean;
}

/**
 * Extracts ssm.tbl entries from a parsed ssm.tbl/*-ssm.tbm - the weapons.tbl `$SSM:`
 * cross-reference target. Confirmed against hudartillery.cpp's `parse_ssm()`: NO hard-
 * required section header at all (the parser reads straight through
 * `while (required_string_either("#end", "$SSM:"))` from the top of the file, mirroring
 * rank.tbl's headerless shape - see rankEntries.ts), entries keyed by `$SSM:` itself
 * (the name is the value on that same line, unlike mflash.tbl's two-step `$Mflash:`/
 * `+name:`). Per-entry fields after the name (`+Weapon:`, `+Count:`/`+Min Count:`/`+Max
 * Count:`, `+WarpEffect:`, `+WarpRadius:`, `+WarpTime:`, `+Radius:`/`+Min Radius:`/`+Max
 * Radius:`, `+Offset:`/`+Min Offset:`/`+Max Offset:`, `+Shape:`, `+HUD Message:`,
 * `+Custom Message:`) aren't tracked here - out of scope for what the LSP needs (existence
 * + go-to-definition for the weapon-level `$SSM:` reference).
 */
export function extractSsmEntries(sections: TableSection[]): SsmEntryInfo[] {
  const entries: SsmEntryInfo[] = [];

  for (const section of sections) {
    // Unlike rank.tbl (which optionally skips a legacy bracket/`#Ranks` header),
    // ssm.tbl has NO section-header handling in the real parser at all - it reads
    // `$SSM:` entries straight from the top of the file, so only LOOSE_SECTION_NAME
    // (parser.ts's synthetic no-header catch-all) is ever relevant here.
    if (section.name !== LOOSE_SECTION_NAME) {
      continue;
    }

    let current: SsmEntryInfo | null = null;
    for (const field of section.entries) {
      const key = field.key.trim().toLowerCase();

      if (field.sigil === "$" && key === "ssm") {
        current = { name: field.value.trim(), nameLine: field.line, noCreate: false };
        entries.push(current);
        continue;
      }
      if (!current) {
        continue;
      }

      if (field.sigil === "+" && key === "nocreate") {
        current.noCreate = true;
      }
    }
  }

  return entries;
}
