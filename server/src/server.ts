import { fileURLToPath } from "url";
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  DiagnosticSeverity,
  Diagnostic as LspDiagnostic,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  Hover,
  DocumentSymbol,
  DocumentSymbolParams,
  SymbolKind,
  Range,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { parseTable, ParseResult, ParseDiagnostic, TableSection } from "./parser";
import { findSchemaForFile, TableSchema } from "./schemas";
import { validateAgainstSchema } from "./schemaValidator";
import { extractShipEntries, findCurrentShipEntry, ShipEntryInfo, ShipTextureRef } from "./tableAnalysis/shipEntries";
import { buildEffectiveShipTable, EffectiveShipEntry } from "./tableAnalysis/mergedShipTable";
import { extractWeaponEntries, WeaponEntryInfo, WeaponTextureRef } from "./tableAnalysis/weaponEntries";
import { buildEffectiveWeaponsTable, EffectiveWeaponEntry } from "./tableAnalysis/mergedWeaponsTable";
import { buildEffectiveArmorTable, collectAllDamageTypes, EffectiveArmorEntry } from "./tableAnalysis/mergedArmorTable";
import { buildSearchPath, resolveModelFile, clearVpIndexCache, clearSearchPathCache } from "./modResolution/resolver";
import { loadPofCached, clearPofCache } from "./pofCache";
import { PofModel } from "./pof/types";
import { buildTextureIndex } from "./textureIndex";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

/** Per-document parse cache, keyed by URI. Rebuilt on every content change. */
const parsedByUri = new Map<string, ParseResult>();
/** Per-document ship-entry cache (model file + subsystem references), keyed by URI. */
const shipEntriesByUri = new Map<string, ShipEntryInfo[]>();
/** Per-document weapon-entry cache (model file only - weapons have no subsystem concept), keyed by URI. */
const weaponEntriesByUri = new Map<string, WeaponEntryInfo[]>();

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { triggerCharacters: ["$", "+", "@", "#"] },
      hoverProvider: true,
      documentSymbolProvider: true,
    },
  };
});

documents.onDidChangeContent((change) => {
  validateAndPublish(change.document);
});

documents.onDidClose((e) => {
  parsedByUri.delete(e.document.uri);
  shipEntriesByUri.delete(e.document.uri);
  weaponEntriesByUri.delete(e.document.uri);
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

/**
 * The merged-table/POF/texture caches below are keyed by resolved location, not by the
 * open document, so an edit to a *dependency* file (a sibling .tbm, mod.json/mod.ini, a
 * referenced .pof/texture, a rebuilt .vp) never fires documents.onDidChangeContent for
 * the file currently being edited yet still invalidates what hover/completion should
 * show for it. The client watches those file types (see extension.ts) and forwards
 * changes here. Invalidation is blunt (clear everything) rather than per-file, trading
 * a bit of recomputation for not having to track cross-cache dependency edges correctly.
 */
connection.onDidChangeWatchedFiles(() => {
  clearVpIndexCache();
  clearSearchPathCache();
  clearPofCache();
  effectiveShipTableCache.clear();
  effectiveWeaponsTableCache.clear();
  effectiveArmorTableCache.clear();
  textureIndexCache.clear();
  textureNamesSortedCache.clear();
});

function validateAndPublish(document: TextDocument): void {
  const result = parseTable(document.getText());
  parsedByUri.set(document.uri, result);
  shipEntriesByUri.set(document.uri, extractShipEntries(result.sections));
  weaponEntriesByUri.set(document.uri, extractWeaponEntries(result.sections));

  const schema = findSchemaForFile(document.uri);
  const schemaDiagnostics = schema ? validateAgainstSchema(result.sections, schema) : [];
  const ships = shipEntriesByUri.get(document.uri) ?? [];
  const weapons = weaponEntriesByUri.get(document.uri) ?? [];
  const bankCountDiagnostics = computeBankCountDiagnostics(document.uri, ships);
  const weaponModelDiagnostics = computeWeaponModelDiagnostics(document.uri, weapons);
  const armorTypeDiagnostics = computeArmorTypeDiagnostics(document.uri, ships);
  const damageTypeDiagnostics = computeDamageTypeDiagnostics(document.uri, weapons);
  const textureDiagnostics = computeTextureDiagnostics(document.uri, ships, weapons);

  const diagnostics: LspDiagnostic[] = [
    ...result.diagnostics,
    ...schemaDiagnostics,
    ...bankCountDiagnostics,
    ...weaponModelDiagnostics,
    ...armorTypeDiagnostics,
    ...damageTypeDiagnostics,
    ...textureDiagnostics,
  ].map((d) => ({
    severity: d.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
    range: {
      start: { line: d.line, character: d.startCol },
      end: { line: d.line, character: d.endCol },
    },
    message: d.message,
    source: "fso-lsp",
  }));

  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

/**
 * Cache of the merged/effective ships.tbl view (base .tbl + every active mod's .tbm
 * layers, per fso-table-format's merge algorithm), keyed by the joined search-path
 * directory list.
 */
const effectiveShipTableCache = new Map<string, Map<string, EffectiveShipEntry>>();

function getEffectiveShipTable(searchDirs: string[]): Map<string, EffectiveShipEntry> {
  const key = searchDirs.join("|");
  const cached = effectiveShipTableCache.get(key);
  if (cached) {
    return cached;
  }
  const table = buildEffectiveShipTable(searchDirs);
  effectiveShipTableCache.set(key, table);
  return table;
}

/**
 * Resolves the POF referenced by a ship entry's `$POF file:`, honoring both the mod's
 * dependency-chain search order (mod.json - the modern Knossos-era source of truth, see
 * fso-mod-load-order project memory - or mod.ini as a fallback) AND the .tbm merge
 * order, since a higher-priority mod's *-shp.tbm may override this ship's model file
 * from what's on screen in the currently-open document. Falls back to the
 * locally-parsed value if the merged view doesn't have this ship.
 */
function resolvePofForShipEntry(documentUri: string, ship: ShipEntryInfo): PofModel | null {
  try {
    const filePath = fileURLToPath(documentUri);
    const searchDirs = buildSearchPath(filePath);
    const effective = getEffectiveShipTable(searchDirs).get(ship.name.toLowerCase());
    const modelFile = effective?.modelFile ?? ship.modelFile;
    if (!modelFile) {
      return null;
    }
    const resolved = resolveModelFile(searchDirs, modelFile);
    if (!resolved) {
      return null;
    }
    return loadPofCached(resolved);
  } catch {
    return null;
  }
}

/**
 * Cache of the merged/effective weapons.tbl view, mirroring effectiveShipTableCache.
 */
const effectiveWeaponsTableCache = new Map<string, Map<string, EffectiveWeaponEntry>>();

function getEffectiveWeaponsTable(searchDirs: string[]): Map<string, EffectiveWeaponEntry> {
  const key = searchDirs.join("|");
  const cached = effectiveWeaponsTableCache.get(key);
  if (cached) {
    return cached;
  }
  const table = buildEffectiveWeaponsTable(searchDirs);
  effectiveWeaponsTableCache.set(key, table);
  return table;
}

/**
 * Resolves the POF referenced by a weapon entry's `$Model file:` (missile/bomb-type
 * weapons only - primaries/lasers typically have none), honoring the same search-path
 * and .tbm-merge-order rules as resolvePofForShipEntry(). Weapons have no
 * `$Subsystem:`-equivalent concept, so unlike ships this is only used for a basic
 * found/not-found check and summary info (texture/subobject counts), not name matching.
 */
function resolvePofForWeaponEntry(documentUri: string, weapon: WeaponEntryInfo): PofModel | null {
  try {
    const filePath = fileURLToPath(documentUri);
    const searchDirs = buildSearchPath(filePath);
    const effective = getEffectiveWeaponsTable(searchDirs).get(weapon.name.toLowerCase());
    const modelFile = effective?.modelFile ?? weapon.modelFile;
    if (!modelFile) {
      return null;
    }
    const resolved = resolveModelFile(searchDirs, modelFile);
    if (!resolved) {
      return null;
    }
    return loadPofCached(resolved);
  } catch {
    return null;
  }
}

/**
 * Flags a weapon's `$Model file:` when it can't be resolved anywhere along the active
 * mod's search path - a typo'd or missing missile/bomb model filename. Only checked for
 * fields physically present in this document, same scoping rationale as
 * computeBankCountDiagnostics().
 */
function computeWeaponModelDiagnostics(documentUri: string, weapons: WeaponEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];

  for (const weapon of weapons) {
    if (!weapon.modelFile || weapon.modelFileLine === null) {
      continue;
    }
    const pof = resolvePofForWeaponEntry(documentUri, weapon);
    if (!pof) {
      diagnostics.push({
        line: weapon.modelFileLine,
        startCol: 0,
        endCol: 1000,
        message: `$Model file: "${weapon.modelFile}" could not be resolved along the active mod's search path`,
        severity: "warning",
      });
    }
  }

  return diagnostics;
}

/**
 * Cache of the merged/effective armor.tbl view, mirroring the ship/weapons caches.
 */
const effectiveArmorTableCache = new Map<string, Map<string, EffectiveArmorEntry>>();

function getEffectiveArmorTable(searchDirs: string[]): Map<string, EffectiveArmorEntry> {
  const key = searchDirs.join("|");
  const cached = effectiveArmorTableCache.get(key);
  if (cached) {
    return cached;
  }
  const table = buildEffectiveArmorTable(searchDirs);
  effectiveArmorTableCache.set(key, table);
  return table;
}

/**
 * Cache of the texture/animation basename index (see textureIndex.ts), keyed by the
 * joined search-path directory list - same cache-key convention as the merged-table
 * caches above.
 */
const textureIndexCache = new Map<string, Set<string>>();

function getTextureIndex(searchDirs: string[]): Set<string> {
  const key = searchDirs.join("|");
  const cached = textureIndexCache.get(key);
  if (cached) {
    return cached;
  }
  const index = buildTextureIndex(searchDirs);
  textureIndexCache.set(key, index);
  return index;
}

/**
 * Sorted texture name list, cached separately from the raw index Set (getTextureIndex)
 * since real mod stacks can have 10,000+ textures - re-sorting that on every completion
 * request (formerly done inline in the completion handler) was a real, measurable
 * slowdown reported against a large real install.
 */
const textureNamesSortedCache = new Map<string, string[]>();

function getSortedTextureNames(searchDirs: string[]): string[] {
  const key = searchDirs.join("|");
  const cached = textureNamesSortedCache.get(key);
  if (cached) {
    return cached;
  }
  const names = Array.from(getTextureIndex(searchDirs)).sort();
  textureNamesSortedCache.set(key, names);
  return names;
}

/**
 * Cross-table check: a ship's `$Armor Type:`/`$Shield Armor Type:` should name an
 * armor.tbl `$Name:` entry. If it doesn't match anything in the merged armor table
 * (resolved via this document's own mod search path, same as the POF
 * cross-referencing), the ship/shield silently gets no armor-specific damage
 * resistance - worth flagging. (Ships also have a cosmetic `+Armor:` tech-room display
 * string like "Medium" - that one is NOT an armor.tbl reference and isn't checked here.)
 */
function computeArmorTypeDiagnostics(documentUri: string, ships: ShipEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  let armorTable: Map<string, EffectiveArmorEntry> | null = null;

  const checks: { value: string | null; line: number | null; label: string }[] = [];
  for (const ship of ships) {
    checks.push({ value: ship.armorType, line: ship.armorTypeLine, label: "$Armor Type:" });
    checks.push({ value: ship.shieldArmorType, line: ship.shieldArmorTypeLine, label: "$Shield Armor Type:" });
  }

  for (const check of checks) {
    if (!check.value || check.line === null) {
      continue;
    }
    try {
      if (!armorTable) {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        armorTable = getEffectiveArmorTable(searchDirs);
      }
      if (!armorTable.has(check.value.toLowerCase())) {
        diagnostics.push({
          line: check.line,
          startCol: 0,
          endCol: 1000,
          message: `${check.label} "${check.value}" was not found in armor.tbl (checked across the active mod's search path)`,
          severity: "warning",
        });
      }
    } catch {
      // Can't resolve a search path for this document (e.g. no mod metadata found) - skip silently.
    }
  }

  return diagnostics;
}

/**
 * Cross-table check: a weapon's `$Damage Type:` should be referenced by at least one
 * armor.tbl `$Damage Type:` entry somewhere in the merged armor table; otherwise the
 * weapon's damage type never gets an armor-specific multiplier applied against it.
 */
function computeDamageTypeDiagnostics(documentUri: string, weapons: WeaponEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  let allDamageTypes: Set<string> | null = null;

  for (const weapon of weapons) {
    if (!weapon.damageType || weapon.damageTypeLine === null) {
      continue;
    }
    try {
      if (!allDamageTypes) {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        allDamageTypes = collectAllDamageTypes(getEffectiveArmorTable(searchDirs));
      }
      if (!allDamageTypes.has(weapon.damageType.toLowerCase())) {
        diagnostics.push({
          line: weapon.damageTypeLine,
          startCol: 0,
          endCol: 1000,
          message: `$Damage Type: "${weapon.damageType}" is not referenced by any armor.tbl $Damage Type: entry (checked across the active mod's search path) - it will get no armor-specific multiplier`,
          severity: "warning",
        });
      }
    } catch {
      // Can't resolve a search path for this document (e.g. no mod metadata found) - skip silently.
    }
  }

  return diagnostics;
}

/**
 * Cross-checks a ship's `$Default PBanks:`/`$Default SBanks:` weapon-name-list length
 * against the POF's actual GPNT/MPNT bank count. Only emitted for fields physically
 * present in *this* document (so there's a real line to attach the diagnostic to).
 */
function computeBankCountDiagnostics(documentUri: string, ships: ShipEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];

  for (const ship of ships) {
    if (!ship.defaultPrimaryBanks && !ship.defaultSecondaryBanks) {
      continue;
    }
    const pof = resolvePofForShipEntry(documentUri, ship);
    if (!pof) {
      continue;
    }

    if (ship.defaultPrimaryBanks && pof.primaryBankCount !== null) {
      const declared = ship.defaultPrimaryBanks.weaponNames.length;
      if (declared !== pof.primaryBankCount) {
        diagnostics.push({
          line: ship.defaultPrimaryBanks.line,
          startCol: 0,
          endCol: 1000,
          message: `$Default PBanks: lists ${declared} bank(s) but the model's GPNT chunk defines ${pof.primaryBankCount} primary bank(s)`,
          severity: "warning",
        });
      }
    }

    if (ship.defaultSecondaryBanks && pof.secondaryBankCount !== null) {
      const declared = ship.defaultSecondaryBanks.weaponNames.length;
      if (declared !== pof.secondaryBankCount) {
        diagnostics.push({
          line: ship.defaultSecondaryBanks.line,
          startCol: 0,
          endCol: 1000,
          message: `$Default SBanks: lists ${declared} bank(s) but the model's MPNT chunk defines ${pof.secondaryBankCount} secondary bank(s)`,
          severity: "warning",
        });
      }
    }
  }

  return diagnostics;
}

/**
 * Flags any ship/weapon bitmap-or-animation field (see TEXTURE_FIELDS in
 * shipEntries.ts/weaponEntries.ts) whose value can't be found anywhere on the active
 * mod's search path (data/maps, data/effects, data/hud, data/interface, data/cbanims -
 * loose or inside a .vp). This is the main "avoid typos" ask: any texture/animation
 * name typed into a table gets checked against what's actually on disk.
 */
function computeTextureDiagnostics(
  documentUri: string,
  ships: ShipEntryInfo[],
  weapons: WeaponEntryInfo[],
): ParseDiagnostic[] {
  const allRefs: { sigil: "$" | "+" | "@"; field: string; line: number; value: string }[] = [
    ...ships.flatMap((s) => s.textureRefs),
    ...weapons.flatMap((w) => w.textureRefs),
  ];
  if (allRefs.length === 0) {
    return [];
  }

  let textures: Set<string> | null = null;
  const diagnostics: ParseDiagnostic[] = [];

  for (const ref of allRefs) {
    if (ref.value.toLowerCase() === "<none>" || ref.value === "") {
      continue;
    }
    try {
      if (!textures) {
        textures = getTextureIndex(buildSearchPath(fileURLToPath(documentUri)));
      }
      if (!textures.has(ref.value.toLowerCase())) {
        diagnostics.push({
          line: ref.line,
          startCol: 0,
          endCol: 1000,
          message: `${ref.sigil}${ref.field}: texture/animation "${ref.value}" not found along the active mod's search path (data/maps, data/effects, data/hud, data/interface, data/cbanims)`,
          severity: "warning",
        });
      }
    } catch {
      // Can't resolve a search path for this document - skip silently.
    }
  }

  return diagnostics;
}

/** Every known field name (with sigil) for a table schema, used to drive field-name completion. */
function schemaFieldCompletions(schemaFieldOrder: string[]): CompletionItem[] {
  return schemaFieldOrder.map((field) => ({
    label: `${field}:`,
    kind: CompletionItemKind.Field,
    insertText: `${field}: `,
  }));
}

/**
 * Range spanning a field's whole value token on `line` (from just after the `:` to the
 * end of the line, trimmed of surrounding whitespace on both sides). Used to give
 * texture completions an explicit textEdit range rather than relying on the client's
 * default word-boundary detection, which (being punctuation-based) doesn't treat a
 * hyphen as part of a word - common in real texture names (e.g. `0-anti2-normal`).
 * Without an explicit range, the client re-derives its own (shorter) "current word" at
 * the hyphen and re-queries the server on every keystroke instead of filtering the
 * existing list locally - both the "deleting letters doesn't filter nicely" and "slow
 * to update" symptoms reported against a real, ~19,000-texture mod stack trace back to
 * this same root cause.
 */
function computeLineValueRange(doc: TextDocument, line: number): Range {
  const fullLine = doc
    .getText({ start: { line, character: 0 }, end: { line: line + 1, character: 0 } })
    .replace(/\r?\n$/, "");
  const colonIdx = fullLine.indexOf(":");

  let valueStart = colonIdx + 1;
  while (valueStart < fullLine.length && /\s/.test(fullLine[valueStart])) {
    valueStart++;
  }

  let valueEnd = fullLine.length;
  while (valueEnd > valueStart && /\s/.test(fullLine[valueEnd - 1])) {
    valueEnd--;
  }

  return { start: { line, character: valueStart }, end: { line, character: valueEnd } };
}

connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) {
    return [];
  }

  const linePrefix = doc.getText({
    start: { line: params.position.line, character: 0 },
    end: params.position,
  });

  if (/^\s*\$Subsystem\s*:/i.test(linePrefix)) {
    const ships = shipEntriesByUri.get(params.textDocument.uri) ?? [];
    const current = findCurrentShipEntry(ships, params.position.line);
    const pof = current ? resolvePofForShipEntry(params.textDocument.uri, current) : null;
    if (pof) {
      return pof.subobjects
        .filter((s) => s.name)
        .map((s) => ({
          label: s.name as string,
          kind: CompletionItemKind.Reference,
          detail: `Subsystem in ${current?.modelFile}`,
        }));
    }
  }

  const textureFieldMatch = /^\s*[$+@]([A-Za-z_][A-Za-z0-9 _]*?)\s*:\s*\S*$/.exec(linePrefix);
  if (textureFieldMatch) {
    const fieldKey = textureFieldMatch[1].trim().toLowerCase();
    if (SHIP_TEXTURE_FIELD_KEYS.has(fieldKey) || WEAPON_TEXTURE_FIELD_KEYS.has(fieldKey)) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const names = getSortedTextureNames(searchDirs);
        const range = computeLineValueRange(doc, params.position.line);
        return names.map((name) => ({
          label: name,
          kind: CompletionItemKind.File,
          filterText: name,
          textEdit: { range, newText: name },
        }));
      } catch {
        return [];
      }
    }
  }

  if (/^\s*\$\S*$/.test(linePrefix)) {
    const schema = findSchemaForFile(params.textDocument.uri);
    if (schema) {
      return schemaFieldCompletions(schema.fieldOrder);
    }
  }

  if (/^\s*#/.test(linePrefix)) {
    return [{ label: "#End", kind: CompletionItemKind.Keyword, detail: "Close the current #Section" }];
  }

  return [
    { label: "+nocreate", kind: CompletionItemKind.Keyword, detail: "Modular table: only modify if the entry already exists" },
    { label: "+remove", kind: CompletionItemKind.Keyword, detail: "Modular table: delete a previously parsed entry" },
  ];
});

const SHIP_TEXTURE_FIELD_KEYS = new Set([
  "shield_icon",
  "ship_icon",
  "ship_anim",
  "ship_overhead",
  "thruster normal flame",
  "thruster afterburner flame",
  "briefing icon",
  "briefing icon with cargo",
  "briefing wing icon",
  "briefing wing icon with cargo",
]);
const WEAPON_TEXTURE_FIELD_KEYS = new Set(["hud image", "laser bitmap", "laser glow", "icon", "anim", "tech anim"]);

function formatBankLine(
  label: "Primary" | "Secondary",
  bankList: { weaponNames: string[] } | null,
  source: string | null,
  actualCount: number | null,
): string {
  if (!bankList) {
    return `${label} banks: (not set)`;
  }
  const declared = bankList.weaponNames.length;
  const status = actualCount === null ? "" : declared === actualCount ? " ✓" : ` ⚠️ (model has ${actualCount})`;
  return `${label} banks: ${declared}${status}${source ? ` — from \`${source}\`` : ""}`;
}

function formatPofSummary(pof: PofModel): string {
  return `${pof.subobjects.length} subobject(s), ${pof.textures.length} texture(s)`;
}

function findTextureHover(
  documentUri: string,
  refs: (ShipTextureRef | WeaponTextureRef)[],
  line: number,
): Hover | null {
  const ref = refs.find((r) => r.line === line);
  if (!ref) {
    return null;
  }
  try {
    const textures = getTextureIndex(buildSearchPath(fileURLToPath(documentUri)));
    const found = textures.has(ref.value.toLowerCase());
    return {
      contents: {
        kind: "markdown",
        value: found
          ? `**${ref.sigil}${ref.field}: ${ref.value}** ✓\n\nFound along the active mod's search path.`
          : `**${ref.sigil}${ref.field}: ${ref.value}** ⚠️\n\nNot found along the active mod's search path (data/maps, data/effects, data/hud, data/interface, data/cbanims).`,
      },
    };
  } catch {
    return null;
  }
}

connection.onHover((params): Hover | null => {
  const weapons = weaponEntriesByUri.get(params.textDocument.uri) ?? [];

  const weaponAtLine = weapons.find(
    (w) => w.nameLine === params.position.line || w.modelFileLine === params.position.line,
  );
  if (weaponAtLine) {
    try {
      const filePath = fileURLToPath(params.textDocument.uri);
      const searchDirs = buildSearchPath(filePath);
      const effective = getEffectiveWeaponsTable(searchDirs).get(weaponAtLine.name.toLowerCase());
      if (effective) {
        const layers = effective.layerSources.map((s, i) => `${i + 1}. \`${s}\``).join("\n");
        const pof = effective.modelFile ? resolvePofForWeaponEntry(params.textDocument.uri, weaponAtLine) : null;
        const modelStatus = !effective.modelFile
          ? "(none - primaries/lasers typically have no model)"
          : pof
            ? `\`${effective.modelFile}\` ✓ (${formatPofSummary(pof)})`
            : `\`${effective.modelFile}\` ⚠️ not found along the active mod's search path`;
        return {
          contents: {
            kind: "markdown",
            value:
              `**$Name: ${effective.name}** (effective, across the active mod's search path)\n\n` +
              `Model File: ${modelStatus}${effective.modelFileSource ? `\n\nFrom: \`${effective.modelFileSource}\`` : ""}\n\n` +
              `Layers applied (base first, later wins):\n${layers}`,
          },
        };
      }
    } catch {
      // Fall through to the generic per-line hover below.
    }
  }

  const weaponTextureHover = findTextureHover(
    params.textDocument.uri,
    weapons.flatMap((w) => w.textureRefs),
    params.position.line,
  );
  if (weaponTextureHover) {
    return weaponTextureHover;
  }

  for (const weapon of weapons) {
    if (weapon.damageTypeLine !== params.position.line || !weapon.damageType) {
      continue;
    }
    try {
      const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
      const allDamageTypes = collectAllDamageTypes(getEffectiveArmorTable(searchDirs));
      const found = allDamageTypes.has(weapon.damageType.toLowerCase());
      return {
        contents: {
          kind: "markdown",
          value: found
            ? `**$Damage Type: ${weapon.damageType}** ✓\n\nReferenced by at least one armor.tbl $Damage Type: entry.`
            : `**$Damage Type: ${weapon.damageType}** ⚠️\n\nNot referenced by any armor.tbl $Damage Type: entry along the active mod's search path — this weapon gets no armor-specific multiplier.`,
        },
      };
    } catch {
      // Fall through to the generic per-line hover below.
    }
  }

  const ships = shipEntriesByUri.get(params.textDocument.uri) ?? [];

  const shipAtNameLine = ships.find((s) => s.nameLine === params.position.line);
  if (shipAtNameLine) {
    try {
      const filePath = fileURLToPath(params.textDocument.uri);
      const searchDirs = buildSearchPath(filePath);
      const effective = getEffectiveShipTable(searchDirs).get(shipAtNameLine.name.toLowerCase());
      if (effective) {
        const layers = effective.layerSources.map((s, i) => `${i + 1}. \`${s}\``).join("\n");
        const pof = effective.modelFile ? resolvePofForShipEntry(params.textDocument.uri, shipAtNameLine) : null;
        return {
          contents: {
            kind: "markdown",
            value:
              `**$Name: ${effective.name}** (effective, across the active mod's search path)\n\n` +
              `POF file: \`${effective.modelFile ?? "(none)"}\`${effective.modelFileSource ? ` — from \`${effective.modelFileSource}\`` : ""}\n\n` +
              `Subsystems: ${effective.subsystems.length}${effective.subsystemsSource ? ` — from \`${effective.subsystemsSource}\`` : ""}\n\n` +
              `Armor Type: ${effective.armorType ?? "(none)"}${effective.armorTypeSource ? ` — from \`${effective.armorTypeSource}\`` : ""}\n\n` +
              `${formatBankLine("Primary", effective.defaultPrimaryBanks, effective.defaultPrimaryBanksSource, pof?.primaryBankCount ?? null)}\n\n` +
              `${formatBankLine("Secondary", effective.defaultSecondaryBanks, effective.defaultSecondaryBanksSource, pof?.secondaryBankCount ?? null)}\n\n` +
              `Layers applied (base first, later wins):\n${layers}`,
          },
        };
      }
    } catch {
      // Fall through to the generic per-line hover below.
    }
  }

  const shipTextureHover = findTextureHover(
    params.textDocument.uri,
    ships.flatMap((s) => s.textureRefs),
    params.position.line,
  );
  if (shipTextureHover) {
    return shipTextureHover;
  }

  for (const ship of ships) {
    if ((ship.armorTypeLine === params.position.line && ship.armorType) ||
        (ship.shieldArmorTypeLine === params.position.line && ship.shieldArmorType)) {
      const isShield = ship.shieldArmorTypeLine === params.position.line;
      const value = isShield ? ship.shieldArmorType : ship.armorType;
      const label = isShield ? "$Shield Armor Type:" : "$Armor Type:";
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const found = getEffectiveArmorTable(searchDirs).has((value as string).toLowerCase());
        return {
          contents: {
            kind: "markdown",
            value: found
              ? `**${label} ${value}** ✓\n\nFound in armor.tbl.`
              : `**${label} ${value}** ⚠️\n\nNot found in armor.tbl along the active mod's search path.`,
          },
        };
      } catch {
        // Fall through to the generic per-line hover below.
      }
    }

    if (ship.defaultPrimaryBanks?.line === params.position.line || ship.defaultSecondaryBanks?.line === params.position.line) {
      const isPrimary = ship.defaultPrimaryBanks?.line === params.position.line;
      const bankList = isPrimary ? ship.defaultPrimaryBanks : ship.defaultSecondaryBanks;
      const pof = resolvePofForShipEntry(params.textDocument.uri, ship);
      const actualCount = isPrimary ? pof?.primaryBankCount ?? null : pof?.secondaryBankCount ?? null;
      const declared = bankList?.weaponNames.length ?? 0;
      const label = isPrimary ? "$Default PBanks:" : "$Default SBanks:";
      const status =
        actualCount === null ? "" : declared === actualCount ? " ✓" : ` ⚠️ (model has ${actualCount})`;
      return {
        contents: {
          kind: "markdown",
          value: `**${label}**${status}\n\nDeclares ${declared} bank(s): ${bankList?.weaponNames.map((n) => `\`${n}\``).join(", ") || "(none)"}`,
        },
      };
    }

    const subsystem = ship.subsystems.find((s) => s.line === params.position.line);
    if (!subsystem) {
      continue;
    }

    const pof = resolvePofForShipEntry(params.textDocument.uri, ship);
    if (!pof) {
      return {
        contents: {
          kind: "markdown",
          value: `**$Subsystem: ${subsystem.name}**\n\nCouldn't resolve model file \`${ship.modelFile ?? "(none set)"}\` for ship "${ship.name}" along the active mod's search path.`,
        },
      };
    }

    const match = pof.subobjects.find((s) => (s.name ?? "").toLowerCase() === subsystem.name.toLowerCase());
    if (match) {
      const turretBank =
        pof.turretGunBanks.find((b) => b.baseSubobject === match.submodelNumber) ??
        pof.turretMissileBanks.find((b) => b.baseSubobject === match.submodelNumber);
      const turretNote = turretBank ? `\n\nTurret bank: ${turretBank.firingPointCount} firing point(s)` : "";
      return {
        contents: {
          kind: "markdown",
          value: `**$Subsystem: ${subsystem.name}** ✓\n\nFound in \`${ship.modelFile}\` (submodel #${match.submodelNumber}).${match.properties ? `\n\nProperties: \`${match.properties}\`` : ""}${turretNote}`,
        },
      };
    }

    const knownNames = pof.subobjects
      .map((s) => s.name)
      .filter((n): n is string => !!n)
      .slice(0, 20);
    return {
      contents: {
        kind: "markdown",
        value: `**$Subsystem: ${subsystem.name}** ⚠️\n\nNo matching submodel name found in \`${ship.modelFile}\`.\n\nAvailable names: ${knownNames.length ? knownNames.map((n) => `\`${n}\``).join(", ") : "(none decoded)"}`,
      },
    };
  }

  const result = parsedByUri.get(params.textDocument.uri);
  if (!result) {
    return null;
  }

  for (const section of result.sections) {
    for (const entry of section.entries) {
      if (entry.line === params.position.line) {
        return {
          contents: {
            kind: "markdown",
            value: `**${entry.sigil}${entry.key}**\n\nSection: \`${section.name}\`\n\nValue: \`${entry.value || "(empty)"}\``,
          },
        };
      }
    }
  }

  return null;
});

/**
 * Outline/breadcrumb support: one top-level symbol per `#Section`, with per-entry
 * children when a schema recognizes this document's file type and this section.
 * Reuses the already-populated parsedByUri cache rather than re-parsing.
 */
connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
  const document = documents.get(params.textDocument.uri);
  const result = parsedByUri.get(params.textDocument.uri);
  if (!document || !result) {
    return [];
  }

  const lines = document.getText().split(/\r\n|\r|\n/);
  const lastLine = lines.length - 1;
  const schema = findSchemaForFile(params.textDocument.uri);

  return result.sections.map((section) => {
    const endLine = section.endLine ?? lastLine;
    const sectionMatchesSchema =
      !!schema && schema.sectionNames.some((n) => n.trim().toLowerCase() === section.name.trim().toLowerCase());

    return {
      name: section.name,
      kind: SymbolKind.Namespace,
      range: lineSpanRange(lines, section.startLine, endLine),
      selectionRange: lineSpanRange(lines, section.startLine, section.startLine),
      children: sectionMatchesSchema ? groupEntriesIntoSymbols(section, schema as TableSchema, endLine, lines) : [],
    };
  });
});

/**
 * Splits a section's flat entry list into per-entry `DocumentSymbol`s, starting a new
 * entry each time the schema's `entryKeyField` (always a `$`-sigil field for every
 * schema currently registered - see schemas/index.ts) is seen. An entry's range runs
 * from its key field's line to just before the next entry (or the section's end).
 */
function groupEntriesIntoSymbols(
  section: TableSection,
  schema: TableSchema,
  sectionEndLine: number,
  lines: string[],
): DocumentSymbol[] {
  const keyFieldLower = schema.entryKeyField.trim().toLowerCase();
  const children: DocumentSymbol[] = [];
  let current: { name: string; startLine: number } | null = null;

  const flush = (endLine: number): void => {
    if (!current) {
      return;
    }
    children.push({
      name: current.name || `(unnamed ${schema.entryKeyField})`,
      kind: SymbolKind.Object,
      range: lineSpanRange(lines, current.startLine, Math.max(endLine, current.startLine)),
      selectionRange: lineSpanRange(lines, current.startLine, current.startLine),
    });
  };

  for (const entry of section.entries) {
    if (entry.sigil === "$" && entry.key.trim().toLowerCase() === keyFieldLower) {
      flush(entry.line - 1);
      current = { name: entry.value.trim(), startLine: entry.line };
    }
  }
  flush(sectionEndLine);

  return children;
}

function lineSpanRange(lines: string[], startLine: number, endLine: number): Range {
  return {
    start: { line: startLine, character: 0 },
    end: { line: endLine, character: (lines[endLine] ?? "").length },
  };
}

documents.listen(connection);
connection.listen();
