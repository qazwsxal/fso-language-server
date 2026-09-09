import { EffectiveShipEntry } from "./mergedShipTable";
import { EffectiveWeaponEntry } from "./mergedWeaponsTable";
import { FieldMapEntry } from "./fieldMapMerge";

interface FieldTableRow {
  field: string;
  value: string;
  source: string;
}

/** Escapes a value for use inside a Markdown table cell - just enough to keep a stray "|" from breaking the row. */
function tableCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

/**
 * The longest prefix shared by every given source string, trimmed back to the last path
 * separator (`\` or `/`) so it never splits a path segment or filename in half - e.g.
 * given `E:\Games\Knossos\FS2\Root_fs2.vp :: data/tables/weapons.tbl` and
 * `E:\Games\Knossos\FS2\blueplanetcomplete-3.3.3\data\tables\bp-wep.tbm`, returns
 * `E:\Games\Knossos\FS2\`, not `E:\Games\Knossos\FS2\` + a partial "Root_fs2"/"bluepl...".
 * Returns "" for fewer than 2 sources (nothing to de-duplicate) or when they share nothing.
 */
export function computeSharedSourcePrefix(sources: string[]): string {
  const distinct = Array.from(new Set(sources.filter((s) => s.length > 0)));
  if (distinct.length < 2) {
    return "";
  }
  let prefix = distinct[0];
  for (const s of distinct.slice(1)) {
    let i = 0;
    const max = Math.min(prefix.length, s.length);
    while (i < max && prefix[i] === s[i]) {
      i++;
    }
    prefix = prefix.slice(0, i);
    if (prefix === "") {
      return "";
    }
  }
  const lastSep = Math.max(prefix.lastIndexOf("\\"), prefix.lastIndexOf("/"));
  return lastSep >= 0 ? prefix.slice(0, lastSep + 1) : "";
}

/** Strips `prefix` from the start of `source`, if present - the display-time counterpart to computeSharedSourcePrefix(). */
export function stripSharedSourcePrefix(source: string, prefix: string): string {
  return prefix && source.startsWith(prefix) ? source.slice(prefix.length) : source;
}

/**
 * Renders every tracked field NOT already shown in the hover's "nice" summary section
 * above (see server.ts's onHover) as one Markdown table, sorted by field name. Unset
 * fields are simply omitted rather than padded with "(none)" rows - same "only show
 * what's actually there" convention the sound/texture maps already use.
 */
function renderFieldTable(rows: FieldTableRow[], sharedPrefix: string): string {
  if (rows.length === 0) {
    return "";
  }
  const sorted = [...rows].sort((a, b) => a.field.localeCompare(b.field));
  const body = sorted
    .map((r) => `| ${tableCell(r.field)} | ${tableCell(r.value)} | ${tableCell(stripSharedSourcePrefix(r.source, sharedPrefix))} |`)
    .join("\n");
  return `| Field | Value | Source |\n| --- | --- | --- |\n${body}`;
}

function namedFieldMapRows(fields: Map<string, FieldMapEntry>): FieldTableRow[] {
  return Array.from(fields.values()).map((entry) => ({ field: entry.field, value: entry.value, source: entry.source }));
}

/**
 * The "all other tracked fields" table for a ship's hover - everything EffectiveShipEntry
 * tracks that isn't already surfaced in the hover's POF/subsystems/armor/bank summary
 * lines: cross-referenced scalars (Species/AI Class/Shield Armor Type), name lists, and
 * every set sound/texture/misc field. Returns "" (render nothing) when there's genuinely
 * nothing to add. `sharedPrefix` (see computeSharedSourcePrefix()) is stripped from every
 * row's Source column - pass "" to show sources in full.
 */
export function renderEffectiveShipFieldTable(entry: EffectiveShipEntry, sharedPrefix = ""): string {
  const rows: FieldTableRow[] = [];
  if (entry.species && entry.speciesSource) {
    rows.push({ field: "Species", value: entry.species, source: entry.speciesSource });
  }
  if (entry.aiClass && entry.aiClassSource) {
    rows.push({ field: "AI Class", value: entry.aiClass, source: entry.aiClassSource });
  }
  if (entry.shieldArmorType && entry.shieldArmorTypeSource) {
    rows.push({ field: "Shield Armor Type", value: entry.shieldArmorType, source: entry.shieldArmorTypeSource });
  }
  if (entry.targetPriorityGroups.length > 0 && entry.targetPriorityGroupsSource) {
    rows.push({ field: "Target Priority Groups", value: entry.targetPriorityGroups.join(", "), source: entry.targetPriorityGroupsSource });
  }
  if (entry.explosionAnimations.length > 0 && entry.explosionAnimationsSource) {
    rows.push({ field: "Explosion Animations", value: entry.explosionAnimations.join(", "), source: entry.explosionAnimationsSource });
  }
  rows.push(...namedFieldMapRows(entry.soundsByField));
  rows.push(...namedFieldMapRows(entry.texturesByField));
  rows.push(...namedFieldMapRows(entry.miscFieldsByField));
  return renderFieldTable(rows, sharedPrefix);
}

/** Same as renderEffectiveShipFieldTable(), for a weapon's hover - Damage Type plus every set sound/texture/misc field. */
export function renderEffectiveWeaponFieldTable(entry: EffectiveWeaponEntry, sharedPrefix = ""): string {
  const rows: FieldTableRow[] = [];
  if (entry.damageType && entry.damageTypeSource) {
    rows.push({ field: "Damage Type", value: entry.damageType, source: entry.damageTypeSource });
  }
  rows.push(...namedFieldMapRows(entry.soundsByField));
  rows.push(...namedFieldMapRows(entry.texturesByField));
  rows.push(...namedFieldMapRows(entry.miscFieldsByField));
  return renderFieldTable(rows, sharedPrefix);
}
