import { EffectiveShipEntry } from "./mergedShipTable";
import { EffectiveWeaponEntry } from "./mergedWeaponsTable";
import { ShipBankList } from "./shipEntries";
import { FieldMapEntry } from "./fieldMapMerge";

const HEADER_NOTE = [
  ";; This is a read-only, synthesized summary - not valid FSO table syntax, and not",
  ";; something FSO itself would ever parse. It covers only the fields fso-lsp tracks",
  ";; structurally today, not the complete real field set for this table.",
].join("\n");

function fieldLine(label: string, value: string | null, source: string | null): string {
  const rendered = value && value.length > 0 ? value : "(none)";
  return `$${label}: ${rendered}${source ? ` ;; ${source}` : ""}`;
}

function bankListLine(label: string, bankList: ShipBankList | null, source: string | null): string {
  if (!bankList || bankList.weaponNames.length === 0) {
    return `$${label}: (none)`;
  }
  const names = bankList.weaponNames.map((n) => `"${n}"`).join(" ");
  return `$${label}: ( ${names} )${source ? ` ;; ${source}` : ""}`;
}

function nameListLine(label: string, names: string[], source: string | null): string {
  if (names.length === 0) {
    return `$${label}: (none)`;
  }
  return `$${label}: ( ${names.join(", ")} )${source ? ` ;; ${source}` : ""}`;
}

/**
 * Renders every entry of a soundsByField/texturesByField map, one `$Field: value` line
 * apiece, sorted by the field's own display casing so the output is stable across runs.
 * Unlike the scalar fields above (which are always shown, even as "(none)", matching
 * existing hover behavior), an unset field here is simply omitted - showing all ~50
 * possible sound fields as "(none)" would bury the handful that actually matter.
 */
function namedFieldMapLines(fields: Map<string, FieldMapEntry>): string[] {
  return Array.from(fields.values())
    .sort((a, b) => a.field.localeCompare(b.field))
    .map((entry) => `$${entry.field}: ${entry.value} ;; ${entry.source}`);
}

function layersFooter(layerSources: string[]): string {
  const lines = layerSources.map((s, i) => `;;   ${i + 1}. ${s}`);
  return [";; Layers applied (base first, later wins):", ...lines].join("\n");
}

export function renderEffectiveShipEntry(entry: EffectiveShipEntry): string {
  const soundLines = namedFieldMapLines(entry.soundsByField);
  const textureLines = namedFieldMapLines(entry.texturesByField);

  const lines = [
    `;; Effective definition for "${entry.name}" (ships.tbl)`,
    HEADER_NOTE,
    "",
    `$Name: ${entry.name}`,
    fieldLine("Model File", entry.modelFile, entry.modelFileSource),
    `$Subsystems: ${entry.subsystems.length}${entry.subsystemsSource ? ` ;; ${entry.subsystemsSource}` : ""}`,
    fieldLine("Armor Type", entry.armorType, entry.armorTypeSource),
    fieldLine("Shield Armor Type", entry.shieldArmorType, entry.shieldArmorTypeSource),
    fieldLine("Species", entry.species, entry.speciesSource),
    fieldLine("AI Class", entry.aiClass, entry.aiClassSource),
    nameListLine("Target Priority Groups", entry.targetPriorityGroups, entry.targetPriorityGroupsSource),
    nameListLine("Explosion Animations", entry.explosionAnimations, entry.explosionAnimationsSource),
    bankListLine("Default PBanks", entry.defaultPrimaryBanks, entry.defaultPrimaryBanksSource),
    bankListLine("Default SBanks", entry.defaultSecondaryBanks, entry.defaultSecondaryBanksSource),
  ];

  if (soundLines.length > 0) {
    lines.push("", ...soundLines);
  }
  if (textureLines.length > 0) {
    lines.push("", ...textureLines);
  }

  lines.push("", layersFooter(entry.layerSources));

  return lines.join("\n") + "\n";
}

export function renderEffectiveWeaponEntry(entry: EffectiveWeaponEntry): string {
  const soundLines = namedFieldMapLines(entry.soundsByField);
  const textureLines = namedFieldMapLines(entry.texturesByField);

  const lines = [
    `;; Effective definition for "${entry.name}" (weapons.tbl)`,
    HEADER_NOTE,
    "",
    `$Name: ${entry.name}`,
    fieldLine("Model File", entry.modelFile, entry.modelFileSource),
    fieldLine("Damage Type", entry.damageType, entry.damageTypeSource),
  ];

  if (soundLines.length > 0) {
    lines.push("", ...soundLines);
  }
  if (textureLines.length > 0) {
    lines.push("", ...textureLines);
  }

  lines.push("", layersFooter(entry.layerSources));

  return lines.join("\n") + "\n";
}
