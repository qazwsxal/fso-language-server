import { fileURLToPath, pathToFileURL } from "url";
import * as path from "path";
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
  Location,
  DefinitionParams,
  DeclarationParams,
  Position,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { parseTable, ParseResult, ParseDiagnostic, TableSection, LOOSE_SECTION_NAME } from "./parser";
import { findSchemaForFile, TableSchema } from "./schemas";
import { validateAgainstSchema } from "./schemaValidator";
import { extractShipEntries, findCurrentShipEntry, ShipEntryInfo, ShipTextureRef } from "./tableAnalysis/shipEntries";
import { buildEffectiveShipTable, EffectiveShipEntry } from "./tableAnalysis/mergedShipTable";
import { extractWeaponEntries, WeaponEntryInfo, WeaponTextureRef } from "./tableAnalysis/weaponEntries";
import { buildEffectiveWeaponsTable, collectDisplayWeaponNames, EffectiveWeaponEntry } from "./tableAnalysis/mergedWeaponsTable";
import {
  buildEffectiveArmorTable,
  collectAllDamageTypes,
  collectDisplayDamageTypes,
  findDamageTypeLocations,
  EffectiveArmorEntry,
  SourceLocation,
} from "./tableAnalysis/mergedArmorTable";
import { extractSpeciesEntries, SpeciesEntryInfo } from "./tableAnalysis/speciesEntries";
import { buildEffectiveSpeciesTable, collectDisplaySpeciesNames, EffectiveSpeciesEntry } from "./tableAnalysis/mergedSpeciesTable";
import { buildEffectiveAiClassTable, collectDisplayAiClassNames, EffectiveAiClassEntry } from "./tableAnalysis/mergedAiClassTable";
import { buildEffectiveIffTable, collectDisplayIffNames, EffectiveIffEntry } from "./tableAnalysis/mergedIffTable";
import { extractAsteroidEntries } from "./tableAnalysis/asteroidEntries";
import { buildEffectiveAsteroidTable, EffectiveAsteroidEntry } from "./tableAnalysis/mergedAsteroidTable";
import { extractFireballEntries } from "./tableAnalysis/fireballEntries";
import {
  buildEffectiveFireballTable,
  resolveFireballReference,
  collectFireballUniqueIds,
  EffectiveFireballEntry,
} from "./tableAnalysis/mergedFireballTable";
import { extractMedalEntries } from "./tableAnalysis/medalsEntries";
import { buildEffectiveMedalsTable, EffectiveMedalEntry } from "./tableAnalysis/mergedMedalsTable";
import { extractRankEntries } from "./tableAnalysis/rankEntries";
import { buildEffectiveRankTable, EffectiveRankEntry } from "./tableAnalysis/mergedRankTable";
import { extractAiProfileEntries } from "./tableAnalysis/aiProfilesEntries";
import { buildEffectiveAiProfilesTable, EffectiveAiProfileEntry } from "./tableAnalysis/mergedAiProfilesTable";
import { extractSoundEntries } from "./tableAnalysis/soundsEntries";
import {
  buildEffectiveSoundsTable,
  collectDisplayNamesForKind as soundsDisplayNamesForKind,
  EffectiveSoundEntry,
  mapKey as soundsMapKey,
} from "./tableAnalysis/mergedSoundsTable";
import { extractObjectTypeEntries } from "./tableAnalysis/objectTypesEntries";
import {
  buildEffectiveObjectTypesTable,
  collectDisplayNamesForKind as objectTypesDisplayNamesForKind,
  EffectiveObjectTypeEntry,
  mapKey as objectTypesMapKey,
} from "./tableAnalysis/mergedObjectTypesTable";
import {
  buildSearchPath,
  resolveModelFile,
  clearVpIndexCache,
  clearSearchPathCache,
  describeResolvedSource,
  ResolvedFile,
} from "./modResolution/resolver";
import { loadPofCached, clearPofCache } from "./pofCache";
import { PofModel } from "./pof/types";
import { decodeSubmodelGeometry } from "./pof/geometry";
import { classifySubmodels } from "./pof/classify";
import { buildTextureIndex } from "./textureIndex";
import { readVpIndex, readVpEntry } from "./vp/reader";

/**
 * Custom URI scheme for a definition target that lives inside a VP/VPC archive rather
 * than as a loose file - there's no real filesystem path to point a `file://` URI at.
 * The client (extension.ts) registers a TextDocumentContentProvider for this scheme
 * that calls back into this server (via the `fso-lsp/readVpEntryText` request below) to
 * fetch the decoded text; VSCode treats content-provider-backed documents as read-only
 * by construction, which is exactly the "readonly copy" behavior wanted here.
 */
const VP_CONTENT_SCHEME = "fso-tbl-vp";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

/** Per-document parse cache, keyed by URI. Rebuilt on every content change. */
const parsedByUri = new Map<string, ParseResult>();
/** Per-document ship-entry cache (model file + subsystem references), keyed by URI. */
const shipEntriesByUri = new Map<string, ShipEntryInfo[]>();
/** Per-document weapon-entry cache (model file only - weapons have no subsystem concept), keyed by URI. */
const weaponEntriesByUri = new Map<string, WeaponEntryInfo[]>();
/** Per-document species-entry cache (currently just `$Default IFF:`), keyed by URI. */
const speciesEntriesByUri = new Map<string, SpeciesEntryInfo[]>();

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { triggerCharacters: ["$", "+", "@", "#"] },
      hoverProvider: true,
      documentSymbolProvider: true,
      definitionProvider: true,
      declarationProvider: true,
    },
  };
});

/**
 * Lets the client's virtual-document content provider (for definition targets inside a
 * VP/VPC archive) fetch decoded text without duplicating any VP-reading logic
 * client-side - see extension.ts's registerTextDocumentContentProvider() for the scheme
 * this backs.
 */
connection.onRequest("fso-lsp/readVpEntryText", ({ vpPath, entryPath }: { vpPath: string; entryPath: string }): string => {
  const archive = readVpIndex(vpPath);
  const entry = archive.entries.find((e) => e.path === entryPath);
  if (!entry) {
    return `; entry not found: ${entryPath} in ${vpPath}`;
  }
  return readVpEntry(vpPath, entry).toString("utf8");
});

/**
 * Converts a SourceLocation (a resolved file/VP entry + line number, as tracked by the
 * merged armor table) into an LSP Location the client can navigate to. A loose file
 * gets a real `file://` URI (opens as a normal, editable file, even if outside the
 * current workspace folder - exactly how "go to definition into a dependency" works in
 * most tools). A VP-sourced entry gets the custom `fso-tbl-vp:` scheme instead, whose
 * query string carries the archive path and whose path carries the entry path within
 * it - the client's registered content provider decodes this back into the two pieces
 * to fetch the text via the `fso-lsp/readVpEntryText` request above.
 */
function toDefinitionLocation(loc: SourceLocation): Location {
  const range = { start: { line: loc.line, character: 0 }, end: { line: loc.line, character: 1000 } };
  if (loc.resolved.kind === "loose") {
    return { uri: pathToFileURL(loc.resolved.containerPath).toString(), range };
  }
  const entryPath = loc.resolved.entryPath ?? "";
  const uri = `${VP_CONTENT_SCHEME}:/${entryPath}?vp=${encodeURIComponent(loc.resolved.containerPath)}`;
  return { uri, range };
}

/**
 * Finds the ref (if any) at `line` within a ship's/weapon's `soundRefs`/`textureRefs`
 * list - the same shape findSoundHover()/findTextureHover() match on, reused here so
 * go-to-definition and hover agree on what counts as "on" a one-value-per-line field.
 */
function findRefAtLine(refs: (ShipTextureRef | WeaponTextureRef)[], line: number): ShipTextureRef | WeaponTextureRef | undefined {
  return refs.find((r) => r.line === line);
}

/**
 * Resolves a sound-referencing field's value to its sounds.tbl `$Name:` definition
 * site(s), mirroring findSoundHover()'s lookup (always the merged table's `"game"` kind -
 * see [[fso-gamesnd-lookup]] project memory) but returning LSP Locations instead of a
 * hover string. `<none>`/empty/`-1` are the same "no sound set" sentinels
 * computeSoundDiagnostics() skips - nothing to jump to for those.
 */
function resolveSoundDefinition(documentUri: string, value: string): Location[] | null {
  if (value.toLowerCase() === "<none>" || value === "" || value === "-1") {
    return null;
  }
  try {
    const searchDirs = buildSearchPath(fileURLToPath(documentUri));
    const entry = getEffectiveSoundsTable(searchDirs).get(soundsMapKey("game", value));
    return entry?.allLocations?.length ? entry.allLocations.map(toDefinitionLocation) : null;
  } catch {
    return null;
  }
}

/**
 * Resolves a texture/animation-referencing field's value to the file that defines it,
 * mirroring findTextureHover()'s lookup. Only a **loose** file gets a real go-to-
 * definition target: a texture packed inside a `.vp`/`.vpc` has no safe destination to
 * jump to, since the only virtual-document scheme this project registers
 * (`fso-tbl-vp:`, see toDefinitionLocation()) decodes its content as UTF-8 text for
 * table-file navigation - pointing it at binary image bytes would just render garbage.
 * Hover already tells the user which archive a VP-packed texture lives in; that's as far
 * as navigation for those can safely go until a binary-aware content provider exists.
 */
function resolveTextureDefinition(documentUri: string, value: string): Location[] | null {
  if (value.toLowerCase() === "<none>" || value === "") {
    return null;
  }
  try {
    const searchDirs = buildSearchPath(fileURLToPath(documentUri));
    const resolved = getTextureIndex(searchDirs).get(value.toLowerCase());
    if (!resolved || resolved.kind !== "loose") {
      return null;
    }
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    return [{ uri: pathToFileURL(resolved.containerPath).toString(), range }];
  } catch {
    return null;
  }
}

/**
 * Go-to-definition/declaration: every ship/weapon cross-reference field this project
 * already validates/hovers gets a matching jump target here, mirroring each one's hover
 * lookup exactly (same merged table, same key) so the two features never disagree:
 * - A ship's/weapon's own `$Name:` line -> every layer (base .tbl + every applied .tbm,
 *   in application order) that touched that entry, i.e. "show me every place this thing
 *   gets overridden" - the same list the effective-entry hover's "Layers applied" already
 *   shows, just as jump targets instead of plain text.
 * - Ship `$Armor Type:`/`$Shield Armor Type:` -> the matching armor.tbl `$Name:` line.
 * - Ship `$Species:` -> species_defs.tbl, `$AI Class:` -> ai.tbl.
 * - Ship/weapon sound-referencing fields (`$LaunchSnd:`, `$ImpactSnd:`, etc. - see
 *   [[fso-gamesnd-lookup]]) -> sounds.tbl's Game Sounds section.
 * - Ship/weapon texture/animation-referencing fields -> the texture file on disk, loose
 *   files only (see resolveTextureDefinition()'s doc comment for why VP-packed ones
 *   don't get a target yet).
 * - Ship `$Explosion Animations:` (per name under the cursor) -> fireball.tbl's
 *   `$Unique ID:`-keyed entries.
 * - Ship `$Target Priority Groups:` (per name under the cursor) -> objecttypes.tbl's
 *   `#Target Priorities` section.
 * - Ship `$Default PBanks:`/`$Default SBanks:` (per weapon name under the cursor,
 *   ship-level or per-subsystem) -> weapons.tbl.
 * - Weapon `$Damage Type:` -> every armor.tbl `$Damage Type:` line that references it,
 *   since unlike a name there's no single "the" definition for a shared damage-type tag.
 * - Species `$Default IFF:` -> iff_defs.tbl.
 * Registered for both onDefinition and onDeclaration (see capabilities above) since
 * there's no meaningful distinction between the two for this project's cross-references
 * - a table value doesn't have separate "declared" vs "defined" locations.
 */
function findCrossReferenceDefinition(params: DefinitionParams | DeclarationParams): Location | Location[] | null {
  const documentUri = params.textDocument.uri;
  const line = params.position.line;

  const ships = shipEntriesByUri.get(documentUri) ?? [];
  for (const ship of ships) {
    if (ship.nameLine === line) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const entry = getEffectiveShipTable(searchDirs).get(ship.name.toLowerCase());
        return entry?.allLocations?.length ? entry.allLocations.map(toDefinitionLocation) : null;
      } catch {
        return null;
      }
    }

    const bankList = findBankListAtLine(ship, line);
    if (bankList) {
      const doc = documents.get(documentUri);
      const token = doc ? findBankNameTokenAt(doc, line, params.position.character) : null;
      if (!token || !token.name) {
        return null;
      }
      try {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const entry = getEffectiveWeaponsTable(searchDirs).get(token.name.toLowerCase());
        return entry?.allLocations?.length ? entry.allLocations.map(toDefinitionLocation) : null;
      } catch {
        return null;
      }
    }

    if (ship.speciesLine === line && ship.species) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const entry = getEffectiveSpeciesTable(searchDirs).get(ship.species.toLowerCase());
        return entry?.allLocations?.length ? entry.allLocations.map(toDefinitionLocation) : null;
      } catch {
        return null;
      }
    }

    if (ship.aiClassLine === line && ship.aiClass) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const entry = getEffectiveAiClassTable(searchDirs).get(ship.aiClass.toLowerCase());
        return entry?.allLocations?.length ? entry.allLocations.map(toDefinitionLocation) : null;
      } catch {
        return null;
      }
    }

    const shipTextureRef = findRefAtLine(ship.textureRefs, line);
    if (shipTextureRef) {
      return resolveTextureDefinition(documentUri, shipTextureRef.value);
    }

    const shipSoundRef = findRefAtLine(ship.soundRefs, line);
    if (shipSoundRef) {
      return resolveSoundDefinition(documentUri, shipSoundRef.value);
    }

    if (ship.explosionAnimationsLine === line && ship.explosionAnimations.length > 0) {
      const doc = documents.get(documentUri);
      const token = doc ? findNameListTokenAt(doc, line, params.position.character) : null;
      if (!token || !token.name) {
        return null;
      }
      try {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const entry = resolveFireballReference(getEffectiveFireballTable(searchDirs), token.name);
        return entry?.allLocations?.length ? entry.allLocations.map(toDefinitionLocation) : null;
      } catch {
        return null;
      }
    }

    if (ship.targetPriorityGroupsLine === line && ship.targetPriorityGroups.length > 0) {
      const doc = documents.get(documentUri);
      const token = doc ? findNameListTokenAt(doc, line, params.position.character) : null;
      if (!token || !token.name) {
        return null;
      }
      try {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const entry = getEffectiveObjectTypesTable(searchDirs).get(objectTypesMapKey("target-priorities", token.name));
        return entry?.allLocations?.length ? entry.allLocations.map(toDefinitionLocation) : null;
      } catch {
        return null;
      }
    }

    const isArmor = ship.armorTypeLine === line && ship.armorType;
    const isShieldArmor = ship.shieldArmorTypeLine === line && ship.shieldArmorType;
    if (!isArmor && !isShieldArmor) {
      continue;
    }
    const value = (isArmor ? ship.armorType : ship.shieldArmorType) as string;
    try {
      const searchDirs = buildSearchPath(fileURLToPath(documentUri));
      const entry = getEffectiveArmorTable(searchDirs).get(value.toLowerCase());
      return entry?.allLocations?.length ? entry.allLocations.map(toDefinitionLocation) : null;
    } catch {
      return null;
    }
  }

  const weapons = weaponEntriesByUri.get(documentUri) ?? [];
  for (const weapon of weapons) {
    if (weapon.nameLine === line) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const entry = getEffectiveWeaponsTable(searchDirs).get(weapon.name.toLowerCase());
        return entry?.allLocations?.length ? entry.allLocations.map(toDefinitionLocation) : null;
      } catch {
        return null;
      }
    }

    const weaponTextureRef = findRefAtLine(weapon.textureRefs, line);
    if (weaponTextureRef) {
      return resolveTextureDefinition(documentUri, weaponTextureRef.value);
    }

    const weaponSoundRef = findRefAtLine(weapon.soundRefs, line);
    if (weaponSoundRef) {
      return resolveSoundDefinition(documentUri, weaponSoundRef.value);
    }

    if (weapon.damageTypeLine !== line || !weapon.damageType) {
      continue;
    }
    try {
      const searchDirs = buildSearchPath(fileURLToPath(documentUri));
      const locations = findDamageTypeLocations(getEffectiveArmorTable(searchDirs), weapon.damageType);
      return locations.length > 0 ? locations.map(toDefinitionLocation) : null;
    } catch {
      return null;
    }
  }

  const species = speciesEntriesByUri.get(documentUri) ?? [];
  for (const entry of species) {
    if (entry.defaultIffLine !== line || !entry.defaultIff) {
      continue;
    }
    try {
      const searchDirs = buildSearchPath(fileURLToPath(documentUri));
      const iffEntry = getEffectiveIffTable(searchDirs).get(entry.defaultIff.toLowerCase());
      return iffEntry?.allLocations?.length ? iffEntry.allLocations.map(toDefinitionLocation) : null;
    } catch {
      return null;
    }
  }

  return null;
}

connection.onDefinition((params) => findCrossReferenceDefinition(params));
connection.onDeclaration((params) => findCrossReferenceDefinition(params));

documents.onDidChangeContent((change) => {
  validateAndPublish(change.document);
});

documents.onDidClose((e) => {
  parsedByUri.delete(e.document.uri);
  shipEntriesByUri.delete(e.document.uri);
  weaponEntriesByUri.delete(e.document.uri);
  speciesEntriesByUri.delete(e.document.uri);
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
  effectiveSpeciesTableCache.clear();
  effectiveAiClassTableCache.clear();
  effectiveIffTableCache.clear();
  effectiveAsteroidTableCache.clear();
  effectiveFireballTableCache.clear();
  effectiveMedalsTableCache.clear();
  effectiveRankTableCache.clear();
  effectiveAiProfilesTableCache.clear();
  effectiveSoundsTableCache.clear();
  effectiveObjectTypesTableCache.clear();
  textureIndexCache.clear();
  textureNamesSortedCache.clear();
});

function validateAndPublish(document: TextDocument): void {
  const result = parseTable(document.getText());
  parsedByUri.set(document.uri, result);
  shipEntriesByUri.set(document.uri, extractShipEntries(result.sections));
  weaponEntriesByUri.set(document.uri, extractWeaponEntries(result.sections));
  speciesEntriesByUri.set(document.uri, extractSpeciesEntries(result.sections));

  const schema = findSchemaForFile(document.uri);
  const schemaDiagnostics = schema ? validateAgainstSchema(result.sections, schema) : [];
  const ships = shipEntriesByUri.get(document.uri) ?? [];
  const weapons = weaponEntriesByUri.get(document.uri) ?? [];
  const species = speciesEntriesByUri.get(document.uri) ?? [];
  const bankCountDiagnostics = computeBankCountDiagnostics(document.uri, ships);
  const bankWeaponNameDiagnostics = computeBankWeaponNameDiagnostics(document.uri, ships);
  const weaponModelDiagnostics = computeWeaponModelDiagnostics(document.uri, weapons);
  const armorTypeDiagnostics = computeArmorTypeDiagnostics(document.uri, ships);
  const speciesDiagnostics = computeSpeciesDiagnostics(document.uri, ships);
  const aiClassDiagnostics = computeAiClassDiagnostics(document.uri, ships);
  const explosionAnimationDiagnostics = computeExplosionAnimationDiagnostics(document.uri, ships);
  const targetPriorityGroupsDiagnostics = computeTargetPriorityGroupsDiagnostics(document.uri, ships);
  const iffDiagnostics = computeIffDiagnostics(document.uri, species);
  const damageTypeDiagnostics = computeDamageTypeDiagnostics(document.uri, weapons);
  const textureDiagnostics = computeTextureDiagnostics(document.uri, ships, weapons);
  const soundDiagnostics = computeSoundDiagnostics(document.uri, ships, weapons);

  const diagnostics: LspDiagnostic[] = [
    ...result.diagnostics,
    ...schemaDiagnostics,
    ...bankCountDiagnostics,
    ...bankWeaponNameDiagnostics,
    ...weaponModelDiagnostics,
    ...armorTypeDiagnostics,
    ...speciesDiagnostics,
    ...aiClassDiagnostics,
    ...explosionAnimationDiagnostics,
    ...targetPriorityGroupsDiagnostics,
    ...iffDiagnostics,
    ...damageTypeDiagnostics,
    ...textureDiagnostics,
    ...soundDiagnostics,
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

/** Same resolution as resolvePofForShipEntry(), but returns where the POF actually came from rather than its parsed contents - for hover location display. */
function resolvePofLocationForShipEntry(documentUri: string, ship: ShipEntryInfo): ResolvedFile | null {
  try {
    const filePath = fileURLToPath(documentUri);
    const searchDirs = buildSearchPath(filePath);
    const effective = getEffectiveShipTable(searchDirs).get(ship.name.toLowerCase());
    const modelFile = effective?.modelFile ?? ship.modelFile;
    if (!modelFile) {
      return null;
    }
    return resolveModelFile(searchDirs, modelFile);
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
 * Cache of the merged/effective species_defs.tbl view, mirroring the armor/ship/weapons caches.
 */
const effectiveSpeciesTableCache = new Map<string, Map<string, EffectiveSpeciesEntry>>();

function getEffectiveSpeciesTable(searchDirs: string[]): Map<string, EffectiveSpeciesEntry> {
  const key = searchDirs.join("|");
  const cached = effectiveSpeciesTableCache.get(key);
  if (cached) {
    return cached;
  }
  const table = buildEffectiveSpeciesTable(searchDirs);
  effectiveSpeciesTableCache.set(key, table);
  return table;
}

/**
 * Cache of the merged/effective ai.tbl view, mirroring the species/armor/ship/weapons caches.
 */
const effectiveAiClassTableCache = new Map<string, Map<string, EffectiveAiClassEntry>>();

function getEffectiveAiClassTable(searchDirs: string[]): Map<string, EffectiveAiClassEntry> {
  const key = searchDirs.join("|");
  const cached = effectiveAiClassTableCache.get(key);
  if (cached) {
    return cached;
  }
  const table = buildEffectiveAiClassTable(searchDirs);
  effectiveAiClassTableCache.set(key, table);
  return table;
}

/**
 * Cache of the merged/effective iff_defs.tbl view, mirroring the species/armor/ship/weapons caches.
 */
const effectiveIffTableCache = new Map<string, Map<string, EffectiveIffEntry>>();

function getEffectiveIffTable(searchDirs: string[]): Map<string, EffectiveIffEntry> {
  const key = searchDirs.join("|");
  const cached = effectiveIffTableCache.get(key);
  if (cached) {
    return cached;
  }
  const table = buildEffectiveIffTable(searchDirs);
  effectiveIffTableCache.set(key, table);
  return table;
}

/**
 * Caches of the remaining merged/effective table views, mirroring the ship/weapons/
 * armor/species/aiClass/iff caches above. These tables have no confirmed cross-reference
 * field in shipEntries.ts/weaponEntries.ts yet (unlike armor/species/ai.tbl/iff_defs.tbl,
 * nothing in the currently-extracted ship/weapon fields points at asteroid.tbl,
 * fireball.tbl, medals.tbl, rank.tbl, sounds.tbl, objecttypes.tbl, or ai_profiles.tbl -
 * per project feedback, fabricating an unverified cross-reference field isn't worth the
 * risk), so they're only wired up for self-hover (see findSelfHover()) - showing the
 * merge provenance for whichever entry the cursor is on when a document of that table
 * type is open - rather than the fuller hover/completion/definition treatment ships and
 * weapons get.
 */
const effectiveAsteroidTableCache = new Map<string, Map<string, EffectiveAsteroidEntry>>();
const effectiveFireballTableCache = new Map<string, Map<string, EffectiveFireballEntry>>();
const effectiveMedalsTableCache = new Map<string, Map<string, EffectiveMedalEntry>>();
const effectiveRankTableCache = new Map<string, Map<string, EffectiveRankEntry>>();
const effectiveAiProfilesTableCache = new Map<string, Map<string, EffectiveAiProfileEntry>>();
const effectiveSoundsTableCache = new Map<string, Map<string, EffectiveSoundEntry>>();
const effectiveObjectTypesTableCache = new Map<string, Map<string, EffectiveObjectTypeEntry>>();

function cachedTable<T>(cache: Map<string, Map<string, T>>, searchDirs: string[], build: (dirs: string[]) => Map<string, T>): Map<string, T> {
  const key = searchDirs.join("|");
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const table = build(searchDirs);
  cache.set(key, table);
  return table;
}

function getEffectiveAsteroidTable(searchDirs: string[]): Map<string, EffectiveAsteroidEntry> {
  return cachedTable(effectiveAsteroidTableCache, searchDirs, buildEffectiveAsteroidTable);
}
function getEffectiveFireballTable(searchDirs: string[]): Map<string, EffectiveFireballEntry> {
  return cachedTable(effectiveFireballTableCache, searchDirs, buildEffectiveFireballTable);
}
function getEffectiveMedalsTable(searchDirs: string[]): Map<string, EffectiveMedalEntry> {
  return cachedTable(effectiveMedalsTableCache, searchDirs, buildEffectiveMedalsTable);
}
function getEffectiveRankTable(searchDirs: string[]): Map<string, EffectiveRankEntry> {
  return cachedTable(effectiveRankTableCache, searchDirs, buildEffectiveRankTable);
}
function getEffectiveAiProfilesTable(searchDirs: string[]): Map<string, EffectiveAiProfileEntry> {
  return cachedTable(effectiveAiProfilesTableCache, searchDirs, buildEffectiveAiProfilesTable);
}
function getEffectiveSoundsTable(searchDirs: string[]): Map<string, EffectiveSoundEntry> {
  return cachedTable(effectiveSoundsTableCache, searchDirs, buildEffectiveSoundsTable);
}
function getEffectiveObjectTypesTable(searchDirs: string[]): Map<string, EffectiveObjectTypeEntry> {
  return cachedTable(effectiveObjectTypesTableCache, searchDirs, buildEffectiveObjectTypesTable);
}

/**
 * Cache of the texture/animation basename index (see textureIndex.ts), keyed by the
 * joined search-path directory list - same cache-key convention as the merged-table
 * caches above.
 */
const textureIndexCache = new Map<string, Map<string, ResolvedFile>>();

function getTextureIndex(searchDirs: string[]): Map<string, ResolvedFile> {
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
 * Sorted texture name list, cached separately from the raw index (getTextureIndex)
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
  const names = Array.from(getTextureIndex(searchDirs).keys()).sort();
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
 * Cross-table check: a ship's `$Species:` should name a species_defs.tbl
 * `$Species_Name:` entry. A ship with an unresolvable species falls back to whatever the
 * engine's default species handling does rather than the intended one - worth flagging
 * like every other cross-reference in this file.
 */
function computeSpeciesDiagnostics(documentUri: string, ships: ShipEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  let speciesTable: Map<string, EffectiveSpeciesEntry> | null = null;

  for (const ship of ships) {
    if (!ship.species || ship.speciesLine === null) {
      continue;
    }
    try {
      if (!speciesTable) {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        speciesTable = getEffectiveSpeciesTable(searchDirs);
      }
      if (!speciesTable.has(ship.species.toLowerCase())) {
        diagnostics.push({
          line: ship.speciesLine,
          startCol: 0,
          endCol: 1000,
          message: `$Species: "${ship.species}" was not found in species_defs.tbl (checked across the active mod's search path)`,
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
 * Cross-table check: a ship's `$AI Class:` should name an ai.tbl `$Name:` entry (e.g.
 * "Rookie", "Insane"). An unresolvable AI class falls back to whatever the engine's
 * default/clamped handling does rather than the intended skill level.
 */
function computeAiClassDiagnostics(documentUri: string, ships: ShipEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  let aiClassTable: Map<string, EffectiveAiClassEntry> | null = null;

  for (const ship of ships) {
    if (!ship.aiClass || ship.aiClassLine === null) {
      continue;
    }
    try {
      if (!aiClassTable) {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        aiClassTable = getEffectiveAiClassTable(searchDirs);
      }
      if (!aiClassTable.has(ship.aiClass.toLowerCase())) {
        diagnostics.push({
          line: ship.aiClassLine,
          startCol: 0,
          endCol: 1000,
          message: `$AI Class: "${ship.aiClass}" was not found in ai.tbl (checked across the active mod's search path)`,
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
 * Cross-table check: a ship's `$Explosion Animations:` list should name fireball.tbl
 * entries. Live-verified against fireballs.cpp/parselo.cpp: a bare integer resolves by
 * position in the effective `Fireball_info` vector, a quoted string by `unique_id`
 * (explicit or auto-generated) - see resolveFireballReference().
 */
function computeExplosionAnimationDiagnostics(documentUri: string, ships: ShipEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  let fireballTable: Map<string, EffectiveFireballEntry> | null = null;

  for (const ship of ships) {
    if (ship.explosionAnimations.length === 0 || ship.explosionAnimationsLine === null) {
      continue;
    }
    try {
      if (!fireballTable) {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        fireballTable = getEffectiveFireballTable(searchDirs);
      }
      for (const name of ship.explosionAnimations) {
        if (!resolveFireballReference(fireballTable, name)) {
          diagnostics.push({
            line: ship.explosionAnimationsLine,
            startCol: 0,
            endCol: 1000,
            message: `$Explosion Animations: references "${name}" which was not found as a fireball.tbl entry (by numeric index or $Unique ID:) along the active mod's search path`,
            severity: "warning",
          });
        }
      }
    } catch {
      // Can't resolve a search path for this document (e.g. no mod metadata found) - skip silently.
    }
  }

  return diagnostics;
}

/**
 * Cross-table check: a ship's `$Target Priority Groups:` list should name objecttypes.tbl
 * entries. Live-verified against ship.cpp: matched via `stricmp()` against
 * `Ai_tp_list[].name`, which is populated ONLY from objecttypes.tbl's `#Target
 * Priorities` section (confirmed NOT from `#Weapon Targeting Priorities`, despite both
 * sections sharing the same `Ai_tp_list`-lookup-adjacent naming).
 */
function computeTargetPriorityGroupsDiagnostics(documentUri: string, ships: ShipEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  let validNames: Set<string> | null = null;

  for (const ship of ships) {
    if (ship.targetPriorityGroups.length === 0 || ship.targetPriorityGroupsLine === null) {
      continue;
    }
    try {
      if (!validNames) {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const objectTypesTable = getEffectiveObjectTypesTable(searchDirs);
        validNames = new Set(objectTypesDisplayNamesForKind(objectTypesTable, "target-priorities").map((n) => n.toLowerCase()));
      }
      for (const name of ship.targetPriorityGroups) {
        if (!validNames.has(name.toLowerCase())) {
          diagnostics.push({
            line: ship.targetPriorityGroupsLine,
            startCol: 0,
            endCol: 1000,
            message: `$Target Priority Groups: references "${name}" which was not found in objecttypes.tbl's #Target Priorities section (checked across the active mod's search path)`,
            severity: "warning",
          });
        }
      }
    } catch {
      // Can't resolve a search path for this document (e.g. no mod metadata found) - skip silently.
    }
  }

  return diagnostics;
}

/**
 * Cross-table check: a species' `$Default IFF:` should name an iff_defs.tbl
 * `$IFF Name:` entry (e.g. "Friendly", "Hostile"). Only meaningful when a
 * species_defs.tbl/*-sdf.tbm is the document actually open, since that's the only place
 * `$Default IFF:` appears.
 */
function computeIffDiagnostics(documentUri: string, species: SpeciesEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  let iffTable: Map<string, EffectiveIffEntry> | null = null;

  for (const entry of species) {
    if (!entry.defaultIff || entry.defaultIffLine === null) {
      continue;
    }
    try {
      if (!iffTable) {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        iffTable = getEffectiveIffTable(searchDirs);
      }
      if (!iffTable.has(entry.defaultIff.toLowerCase())) {
        diagnostics.push({
          line: entry.defaultIffLine,
          startCol: 0,
          endCol: 1000,
          message: `$Default IFF: "${entry.defaultIff}" was not found in iff_defs.tbl (checked across the active mod's search path)`,
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

    // A turret's own $Default PBanks:/$Default SBanks: should have one entry per
    // TGUN/TMIS bank the POF actually defines at that turret's base submodel - mirrors
    // the ship-level GPNT/MPNT check above, just scoped to one submodel's turret banks
    // instead of the whole model's primary/secondary gun points.
    for (const subsystem of ship.subsystems) {
      if (!subsystem.defaultPrimaryBanks && !subsystem.defaultSecondaryBanks) {
        continue;
      }
      const match = pof.subobjects.find((s) => (s.name ?? "").toLowerCase() === subsystem.name.toLowerCase());
      if (!match) {
        continue;
      }

      if (subsystem.defaultPrimaryBanks) {
        const actualCount = pof.turretGunBanks.filter((b) => b.baseSubobject === match.submodelNumber).length;
        const declared = subsystem.defaultPrimaryBanks.weaponNames.length;
        if (actualCount > 0 && declared !== actualCount) {
          diagnostics.push({
            line: subsystem.defaultPrimaryBanks.line,
            startCol: 0,
            endCol: 1000,
            message: `$Default PBanks: lists ${declared} bank(s) but the model's turret "${subsystem.name}" defines ${actualCount} gun bank(s)`,
            severity: "warning",
          });
        }
      }

      if (subsystem.defaultSecondaryBanks) {
        const actualCount = pof.turretMissileBanks.filter((b) => b.baseSubobject === match.submodelNumber).length;
        const declared = subsystem.defaultSecondaryBanks.weaponNames.length;
        if (actualCount > 0 && declared !== actualCount) {
          diagnostics.push({
            line: subsystem.defaultSecondaryBanks.line,
            startCol: 0,
            endCol: 1000,
            message: `$Default SBanks: lists ${declared} bank(s) but the model's turret "${subsystem.name}" defines ${actualCount} missile bank(s)`,
            severity: "warning",
          });
        }
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

  let textures: Map<string, ResolvedFile> | null = null;
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

/**
 * Flags any ship/weapon sound-referencing field (see SOUND_FIELDS in
 * shipEntries.ts/weaponEntries.ts) whose value can't be found in sounds.tbl. Live-verified
 * (see [[fso-gamesnd-lookup]] project memory) that every one of these fields resolves via
 * `parse_game_sound()` against sounds.tbl's Game Sounds section specifically - not
 * Interface/Flyby/Environment sounds, and not a unified list across all four.
 */
function computeSoundDiagnostics(documentUri: string, ships: ShipEntryInfo[], weapons: WeaponEntryInfo[]): ParseDiagnostic[] {
  const allRefs: { sigil: "$" | "+" | "@"; field: string; line: number; value: string }[] = [
    ...ships.flatMap((s) => s.soundRefs),
    ...weapons.flatMap((w) => w.soundRefs),
  ];
  if (allRefs.length === 0) {
    return [];
  }

  let validNames: Set<string> | null = null;
  const diagnostics: ParseDiagnostic[] = [];

  for (const ref of allRefs) {
    if (ref.value.toLowerCase() === "<none>" || ref.value === "" || ref.value === "-1") {
      continue;
    }
    try {
      if (!validNames) {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        validNames = new Set(soundsDisplayNamesForKind(getEffectiveSoundsTable(searchDirs), "game").map((n) => n.toLowerCase()));
      }
      if (!validNames.has(ref.value.toLowerCase())) {
        diagnostics.push({
          line: ref.line,
          startCol: 0,
          endCol: 1000,
          message: `${ref.sigil}${ref.field}: "${ref.value}" was not found in sounds.tbl's Game Sounds section (checked across the active mod's search path)`,
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

/**
 * A single quoted weapon name inside a `$Default PBanks:`/`$Default SBanks:` value
 * (`( "Name" "Name" ... )`), with the exact range of the text between its quotes - used
 * to give per-name hover/go-to-definition on a bank list rather than treating the whole
 * line as one opaque value the way the bank-count check does.
 */
interface BankNameToken {
  name: string;
  range: Range;
}

/** Every closed `"..."` quoted token on `line`, in document order. For hover/go-to-definition, where the document is settled and every quote is expected to be closed. */
function computeBankNameTokens(doc: TextDocument, line: number): BankNameToken[] {
  const fullLine = doc
    .getText({ start: { line, character: 0 }, end: { line: line + 1, character: 0 } })
    .replace(/\r?\n$/, "");
  const tokens: BankNameToken[] = [];
  const quoteRe = /"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = quoteRe.exec(fullLine))) {
    const start = match.index + 1;
    const end = start + match[1].length;
    tokens.push({ name: match[1].trim(), range: { start: { line, character: start }, end: { line, character: end } } });
  }
  return tokens;
}

/** The closed quoted token (see computeBankNameTokens) that `character` falls within, if any. */
function findBankNameTokenAt(doc: TextDocument, line: number, character: number): BankNameToken | null {
  return computeBankNameTokens(doc, line).find((t) => character >= t.range.start.character && character <= t.range.end.character) ?? null;
}

/**
 * Every name token in a `$Field: ( name name ... )`-style list value on `line`, with
 * exact ranges - for fields like `$Explosion Animations:`/`$Target Priority Groups:`
 * whose quoting convention isn't confirmed (see splitNameList()'s doc comment in
 * shipEntries.ts): quoted tokens (`"Name"`) are preferred if any are present, otherwise
 * falls back to whitespace/comma-separated bare identifiers. Scoped to the text after the
 * field's own `:` (and before any trailing `;` line comment) so the field's own key words
 * can't be misread as list members.
 */
function computeNameListTokens(doc: TextDocument, line: number): BankNameToken[] {
  const fullLine = doc
    .getText({ start: { line, character: 0 }, end: { line: line + 1, character: 0 } })
    .replace(/\r?\n$/, "");
  const colonIdx = fullLine.indexOf(":");
  const valueStart = colonIdx === -1 ? 0 : colonIdx + 1;
  const commentIdx = fullLine.indexOf(";", valueStart);
  const valueText = fullLine.slice(valueStart, commentIdx === -1 ? undefined : commentIdx);

  const tokens: BankNameToken[] = [];
  const quoteRe = /"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = quoteRe.exec(valueText))) {
    const start = valueStart + match.index + 1;
    const end = start + match[1].length;
    tokens.push({ name: match[1].trim(), range: { start: { line, character: start }, end: { line, character: end } } });
  }
  if (tokens.length > 0) {
    return tokens;
  }

  const bareRe = /[^,\s()]+/g;
  while ((match = bareRe.exec(valueText))) {
    const start = valueStart + match.index;
    const end = start + match[0].length;
    tokens.push({ name: match[0], range: { start: { line, character: start }, end: { line, character: end } } });
  }
  return tokens;
}

/** The name-list token (see computeNameListTokens) that `character` falls within, if any. */
function findNameListTokenAt(doc: TextDocument, line: number, character: number): BankNameToken | null {
  return computeNameListTokens(doc, line).find((t) => character >= t.range.start.character && character <= t.range.end.character) ?? null;
}

/**
 * The range of the quote the cursor is currently *inside* while typing (which may not
 * be closed yet - e.g. `( "Subach` with the cursor right after the `h`) - used to give
 * weapon-name completions inside a bank list an explicit textEdit range, same rationale
 * as computeLineValueRange for whole-value texture fields. Returns null when the cursor
 * isn't inside an open quote (e.g. sitting between entries, on the parens/whitespace).
 */
function computeOpenBankTokenRange(doc: TextDocument, position: Position): Range | null {
  const fullLine = doc
    .getText({ start: { line: position.line, character: 0 }, end: { line: position.line + 1, character: 0 } })
    .replace(/\r?\n$/, "");
  const before = fullLine.slice(0, position.character);
  const quotesBefore = (before.match(/"/g) ?? []).length;
  if (quotesBefore % 2 === 0) {
    return null;
  }
  const startQuote = before.lastIndexOf('"');
  let endQuote = fullLine.indexOf('"', position.character);
  if (endQuote === -1) {
    endQuote = fullLine.length;
  }
  return { start: { line: position.line, character: startQuote + 1 }, end: { line: position.line, character: endQuote } };
}

/**
 * The bank list (if any) whose line matches `line` - `$Default PBanks:`/
 * `$Default SBanks:` can occur once at ship level and/or once per `$Subsystem:` block
 * (a turret's own loadout - confirmed as the *majority* real-world occurrence, see
 * ShipSubsystemRef's doc comment in shipEntries.ts).
 */
function findBankListAtLine(ship: ShipEntryInfo, line: number): { weaponNames: string[] } | null {
  if (ship.defaultPrimaryBanks?.line === line) {
    return ship.defaultPrimaryBanks;
  }
  if (ship.defaultSecondaryBanks?.line === line) {
    return ship.defaultSecondaryBanks;
  }
  for (const subsystem of ship.subsystems) {
    if (subsystem.defaultPrimaryBanks?.line === line) {
      return subsystem.defaultPrimaryBanks;
    }
    if (subsystem.defaultSecondaryBanks?.line === line) {
      return subsystem.defaultSecondaryBanks;
    }
  }
  return null;
}

/**
 * Cross-checks each weapon name in a ship's `$Default PBanks:`/`$Default SBanks:` list
 * against the merged weapons.tbl - a typo'd or removed weapon name here silently loads
 * as "no weapon in that bank" rather than erroring, so it's worth flagging like every
 * other cross-reference in this file.
 */
function computeBankWeaponNameDiagnostics(documentUri: string, ships: ShipEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  let weaponsTable: Map<string, EffectiveWeaponEntry> | null = null;

  const lists: { line: number; weaponNames: string[]; label: string }[] = [];
  for (const ship of ships) {
    if (ship.defaultPrimaryBanks) {
      lists.push({ line: ship.defaultPrimaryBanks.line, weaponNames: ship.defaultPrimaryBanks.weaponNames, label: "$Default PBanks:" });
    }
    if (ship.defaultSecondaryBanks) {
      lists.push({ line: ship.defaultSecondaryBanks.line, weaponNames: ship.defaultSecondaryBanks.weaponNames, label: "$Default SBanks:" });
    }
    for (const subsystem of ship.subsystems) {
      if (subsystem.defaultPrimaryBanks) {
        lists.push({ line: subsystem.defaultPrimaryBanks.line, weaponNames: subsystem.defaultPrimaryBanks.weaponNames, label: `$Default PBanks: (turret "${subsystem.name}")` });
      }
      if (subsystem.defaultSecondaryBanks) {
        lists.push({ line: subsystem.defaultSecondaryBanks.line, weaponNames: subsystem.defaultSecondaryBanks.weaponNames, label: `$Default SBanks: (turret "${subsystem.name}")` });
      }
    }
  }

  for (const list of lists) {
    for (const name of list.weaponNames) {
      if (!name) {
        continue;
      }
      try {
        if (!weaponsTable) {
          const searchDirs = buildSearchPath(fileURLToPath(documentUri));
          weaponsTable = getEffectiveWeaponsTable(searchDirs);
        }
        if (!weaponsTable.has(name.toLowerCase())) {
          diagnostics.push({
            line: list.line,
            startCol: 0,
            endCol: 1000,
            message: `${list.label} references weapon "${name}" which was not found in weapons.tbl (checked across the active mod's search path)`,
            severity: "warning",
          });
        }
      } catch {
        // Can't resolve a search path for this document - skip silently.
      }
    }
  }

  return diagnostics;
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

  if (/^\s*\$Default\s+[PS]Banks\s*:/i.test(linePrefix)) {
    const ships = shipEntriesByUri.get(params.textDocument.uri) ?? [];
    const current = findCurrentShipEntry(ships, params.position.line);
    const list = current ? findBankListAtLine(current, params.position.line) : null;
    if (list) {
      const range = computeOpenBankTokenRange(doc, params.position);
      if (range) {
        try {
          const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
          const names = collectDisplayWeaponNames(getEffectiveWeaponsTable(searchDirs)).sort();
          return names.map((name) => ({
            label: name,
            kind: CompletionItemKind.Reference,
            filterText: name,
            textEdit: { range, newText: name },
          }));
        } catch {
          return [];
        }
      }
    }
  }

  if (/^\s*\$Explosion\s+Animations\s*:/i.test(linePrefix)) {
    const range = computeOpenBankTokenRange(doc, params.position);
    if (range) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const names = collectFireballUniqueIds(getEffectiveFireballTable(searchDirs)).sort();
        return names.map((name) => ({
          label: name,
          kind: CompletionItemKind.EnumMember,
          filterText: name,
          textEdit: { range, newText: name },
        }));
      } catch {
        return [];
      }
    }
  }

  if (/^\s*\$Target\s+Priority\s+Groups\s*:/i.test(linePrefix)) {
    const range = computeOpenBankTokenRange(doc, params.position);
    if (range) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const objectTypesTable = getEffectiveObjectTypesTable(searchDirs);
        const names = objectTypesDisplayNamesForKind(objectTypesTable, "target-priorities").sort();
        return names.map((name) => ({
          label: name,
          kind: CompletionItemKind.EnumMember,
          filterText: name,
          textEdit: { range, newText: name },
        }));
      } catch {
        return [];
      }
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

    if (SOUND_FIELD_KEYS.has(fieldKey)) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const names = soundsDisplayNamesForKind(getEffectiveSoundsTable(searchDirs), "game").sort();
        const range = computeLineValueRange(doc, params.position.line);
        return names.map((name) => ({
          label: name,
          kind: CompletionItemKind.EnumMember,
          filterText: name,
          textEdit: { range, newText: name },
        }));
      } catch {
        return [];
      }
    }

    // Cross-table completion: a ship's $Armor Type:/$Shield Armor Type: completes from
    // armor.tbl's entry names; a weapon's $Damage Type: completes from every distinct
    // damage-type string used anywhere in armor.tbl's $Damage Type: entries.
    if (fieldKey === "armor type" || fieldKey === "shield armor type" || fieldKey === "damage type") {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const armorTable = getEffectiveArmorTable(searchDirs);
        const range = computeLineValueRange(doc, params.position.line);
        const names =
          fieldKey === "damage type"
            ? collectDisplayDamageTypes(armorTable).sort()
            : Array.from(armorTable.values())
                .map((e) => e.name)
                .sort();
        return names.map((name) => ({
          label: name,
          kind: CompletionItemKind.EnumMember,
          filterText: name,
          textEdit: { range, newText: name },
        }));
      } catch {
        return [];
      }
    }

    if (fieldKey === "species") {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const names = collectDisplaySpeciesNames(getEffectiveSpeciesTable(searchDirs)).sort();
        const range = computeLineValueRange(doc, params.position.line);
        return names.map((name) => ({
          label: name,
          kind: CompletionItemKind.EnumMember,
          filterText: name,
          textEdit: { range, newText: name },
        }));
      } catch {
        return [];
      }
    }

    if (fieldKey === "ai class") {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const names = collectDisplayAiClassNames(getEffectiveAiClassTable(searchDirs)).sort();
        const range = computeLineValueRange(doc, params.position.line);
        return names.map((name) => ({
          label: name,
          kind: CompletionItemKind.EnumMember,
          filterText: name,
          textEdit: { range, newText: name },
        }));
      } catch {
        return [];
      }
    }

    if (fieldKey === "default iff") {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const names = collectDisplayIffNames(getEffectiveIffTable(searchDirs)).sort();
        const range = computeLineValueRange(doc, params.position.line);
        return names.map((name) => ({
          label: name,
          kind: CompletionItemKind.EnumMember,
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

/**
 * Every ships.tbl/weapons.tbl field key confirmed (see [[fso-gamesnd-lookup]] project
 * memory) to resolve a sound name via `parse_game_sound()` - mirrors SOUND_FIELDS in
 * shipEntries.ts/weaponEntries.ts (kept as a separate constant here, same pattern as
 * SHIP_TEXTURE_FIELD_KEYS/WEAPON_TEXTURE_FIELD_KEYS above, since this drives completion
 * triggering rather than extraction).
 */
const SOUND_FIELD_KEYS = new Set([
  "enginesnd",
  "glidestartsnd",
  "glideendsnd",
  "flyby sound",
  "landing sound",
  "collision sound light",
  "collision sound heavy",
  "collision sound shielded",
  "ambient sound",
  "explosion sound",
  "autoaim lock snd",
  "autoaim lost snd",
  "shockwave sound",
  "startsnd",
  "loopsnd",
  "stopsnd",
  "cockpitenginesnd",
  "fullthrottlesnd",
  "zerothrottlesnd",
  "throttleupsnd",
  "throttledownsnd",
  "afterburnersnd",
  "afterburnerengagesnd",
  "afterburnerfailedsnd",
  "missiletrackingsnd",
  "missilelockedsnd",
  "primarycyclesnd",
  "secondarycyclesnd",
  "targetacquiredsnd",
  "primaryfirefailedsnd",
  "secondaryfirefailedsnd",
  "heatseekerlaunchwarningsnd",
  "aspectseekerlaunchwarningsnd",
  "missilelockwarningsnd",
  "heatseekerproximitywarningsnd",
  "aspectseekerproximitywarningsnd",
  "missileevadedsnd",
  "cargoscanningsnd",
  "deathrollsnd",
  "explosionsnd",
  "subsysexplosionsnd",
  "alivesnd",
  "deadsnd",
  "rotationsnd",
  "turret base rotationsnd",
  "turret gun rotationsnd",
  "prelaunchsnd",
  "launchsnd",
  "cockpitlaunchsnd",
  "impactsnd",
  "disarmed impactsnd",
  "shield impactsnd",
  "flybysnd",
  "ambientsnd",
  "startfiringsnd",
  "loopfiringsnd",
  "linkedloopfiringsnd",
  "endfiringsnd",
  "trackingsnd",
  "lockedsnd",
  "inflightsnd",
  "beamsound",
  "warmupsound",
  "warmdownsound",
]);

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
    const location = textures.get(ref.value.toLowerCase());
    return {
      contents: {
        kind: "markdown",
        value: location
          ? `**${ref.sigil}${ref.field}: ${ref.value}** ✓\n\nFound at:\n\`${describeResolvedSource(location)}\``
          : `**${ref.sigil}${ref.field}: ${ref.value}** ⚠️\n\nNot found along the active mod's search path (data/maps, data/effects, data/hud, data/interface, data/cbanims).`,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Hover for a ship/weapon sound-referencing field (see SOUND_FIELDS in
 * shipEntries.ts/weaponEntries.ts) - mirrors findTextureHover()'s shape, but resolves
 * against the merged sounds.tbl "game" kind instead of the texture index (see
 * [[fso-gamesnd-lookup]] project memory for why it's always "game").
 */
function findSoundHover(documentUri: string, refs: (ShipTextureRef | WeaponTextureRef)[], line: number): Hover | null {
  const ref = refs.find((r) => r.line === line);
  if (!ref) {
    return null;
  }
  try {
    const searchDirs = buildSearchPath(fileURLToPath(documentUri));
    const soundsTable = getEffectiveSoundsTable(searchDirs);
    const entry = soundsTable.get(soundsMapKey("game", ref.value));
    return {
      contents: {
        kind: "markdown",
        value: entry?.nameLocation
          ? `**${ref.sigil}${ref.field}: ${ref.value}** ✓\n\nDefined at:\n\`${describeResolvedSource(entry.nameLocation.resolved)}:${entry.nameLocation.line + 1}\``
          : `**${ref.sigil}${ref.field}: ${ref.value}** ⚠️\n\nNot found in sounds.tbl's Game Sounds section along the active mod's search path.`,
      },
    };
  } catch {
    return null;
  }
}

/** Renders the same "effective, merge provenance" hover shape used for ship/weapon self-hover, generalized for the simpler single-string-identity tables below. */
function formatEffectiveEntryHover(label: string, name: string, layerSources: string[]): Hover {
  const layers = layerSources.map((s, i) => `${i + 1}. \`${s}\``).join("\n");
  return {
    contents: {
      kind: "markdown",
      value: `**${label}: ${name}** (effective, across the active mod's search path)\n\nLayers applied (base first, later wins):\n${layers}`,
    },
  };
}

/**
 * Self-hover (on the entry's own identity line) for the merged tables that don't yet
 * have a confirmed cross-reference field to hang richer hover/completion/definition off
 * of - see the effectiveAsteroidTableCache doc comment above. Shows the same
 * "effective, across every applied .tbm layer" provenance ships/weapons get, just
 * without the model/texture/bank-list extras those two have.
 */
function findAuxiliaryTableSelfHover(documentUri: string, line: number): Hover | null {
  const result = parsedByUri.get(documentUri);
  if (!result) {
    return null;
  }

  let searchDirs: string[] | null = null;
  const getSearchDirs = (): string[] => searchDirs ?? (searchDirs = buildSearchPath(fileURLToPath(documentUri)));

  const asteroid = extractAsteroidEntries(result.sections).find((e) => e.nameLine === line);
  if (asteroid) {
    try {
      const entry = getEffectiveAsteroidTable(getSearchDirs()).get(asteroid.name.toLowerCase());
      if (entry) {
        return formatEffectiveEntryHover("$Name", entry.name, entry.layerSources);
      }
    } catch {
      // Can't resolve a search path for this document - fall through.
    }
  }

  const fireball = extractFireballEntries(result.sections).find((e) => e.nameLine === line);
  if (fireball) {
    try {
      const entry = getEffectiveFireballTable(getSearchDirs()).get(fireball.name.toLowerCase());
      if (entry) {
        return formatEffectiveEntryHover(fireball.keyedByUniqueId ? "$Unique ID" : "$Name", entry.name, entry.layerSources);
      }
    } catch {
      // Can't resolve a search path for this document - fall through.
    }
  }

  const medal = extractMedalEntries(result.sections).find((e) => e.nameLine === line);
  if (medal) {
    try {
      const entry = getEffectiveMedalsTable(getSearchDirs()).get(medal.name.toLowerCase());
      if (entry) {
        return formatEffectiveEntryHover("$Name", entry.name, entry.layerSources);
      }
    } catch {
      // Can't resolve a search path for this document - fall through.
    }
  }

  const rank = extractRankEntries(result.sections).find((e) => e.nameLine === line);
  if (rank) {
    try {
      const entry = getEffectiveRankTable(getSearchDirs()).get(rank.name.toLowerCase());
      if (entry) {
        return formatEffectiveEntryHover("$Name", entry.name, entry.layerSources);
      }
    } catch {
      // Can't resolve a search path for this document - fall through.
    }
  }

  const aiProfile = extractAiProfileEntries(result.sections).find((e) => e.nameLine === line);
  if (aiProfile) {
    try {
      const entry = getEffectiveAiProfilesTable(getSearchDirs()).get(aiProfile.name.toLowerCase());
      if (entry) {
        return formatEffectiveEntryHover("$Profile Name", entry.name, entry.layerSources);
      }
    } catch {
      // Can't resolve a search path for this document - fall through.
    }
  }

  const sound = extractSoundEntries(result.sections).find((e) => e.nameLine === line);
  if (sound) {
    try {
      const entry = getEffectiveSoundsTable(getSearchDirs()).get(soundsMapKey(sound.kind, sound.name));
      if (entry) {
        return formatEffectiveEntryHover(`$Name (${sound.kind} sound)`, entry.name, entry.layerSources);
      }
    } catch {
      // Can't resolve a search path for this document - fall through.
    }
  }

  const objectType = extractObjectTypeEntries(result.sections).find((e) => e.nameLine === line);
  if (objectType) {
    try {
      const entry = getEffectiveObjectTypesTable(getSearchDirs()).get(objectTypesMapKey(objectType.kind, objectType.name));
      if (entry) {
        return formatEffectiveEntryHover(`$Name (${objectType.kind})`, entry.name, entry.layerSources);
      }
    } catch {
      // Can't resolve a search path for this document - fall through.
    }
  }

  return null;
}

connection.onHover((params): Hover | null => {
  const auxiliaryHover = findAuxiliaryTableSelfHover(params.textDocument.uri, params.position.line);
  if (auxiliaryHover) {
    return auxiliaryHover;
  }

  const hoverDoc = documents.get(params.textDocument.uri);
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

  const weaponSoundHover = findSoundHover(
    params.textDocument.uri,
    weapons.flatMap((w) => w.soundRefs),
    params.position.line,
  );
  if (weaponSoundHover) {
    return weaponSoundHover;
  }

  for (const weapon of weapons) {
    if (weapon.damageTypeLine !== params.position.line || !weapon.damageType) {
      continue;
    }
    try {
      const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
      const armorTable = getEffectiveArmorTable(searchDirs);
      const locations = findDamageTypeLocations(armorTable, weapon.damageType);
      const locationList = locations
        .map((loc, i) => `${i + 1}. \`${describeResolvedSource(loc.resolved)}:${loc.line + 1}\``)
        .join("\n");
      return {
        contents: {
          kind: "markdown",
          value:
            locations.length > 0
              ? `**$Damage Type: ${weapon.damageType}** ✓\n\nReferenced by armor.tbl at:\n${locationList}`
              : `**$Damage Type: ${weapon.damageType}** ⚠️\n\nNot referenced by any armor.tbl $Damage Type: entry along the active mod's search path — this weapon gets no armor-specific multiplier.`,
        },
      };
    } catch {
      // Fall through to the generic per-line hover below.
    }
  }

  const species = speciesEntriesByUri.get(params.textDocument.uri) ?? [];
  for (const entry of species) {
    if (entry.defaultIffLine !== params.position.line || !entry.defaultIff) {
      continue;
    }
    try {
      const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
      const iffEntry = getEffectiveIffTable(searchDirs).get(entry.defaultIff.toLowerCase());
      return {
        contents: {
          kind: "markdown",
          value: iffEntry?.nameLocation
            ? `**$Default IFF: ${entry.defaultIff}** ✓\n\nDefined at:\n\`${describeResolvedSource(iffEntry.nameLocation.resolved)}:${iffEntry.nameLocation.line + 1}\``
            : `**$Default IFF: ${entry.defaultIff}** ⚠️\n\nNot found in iff_defs.tbl along the active mod's search path.`,
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

  const shipSoundHover = findSoundHover(
    params.textDocument.uri,
    ships.flatMap((s) => s.soundRefs),
    params.position.line,
  );
  if (shipSoundHover) {
    return shipSoundHover;
  }

  for (const ship of ships) {
    if ((ship.armorTypeLine === params.position.line && ship.armorType) ||
        (ship.shieldArmorTypeLine === params.position.line && ship.shieldArmorType)) {
      const isShield = ship.shieldArmorTypeLine === params.position.line;
      const value = isShield ? ship.shieldArmorType : ship.armorType;
      const label = isShield ? "$Shield Armor Type:" : "$Armor Type:";
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const entry = getEffectiveArmorTable(searchDirs).get((value as string).toLowerCase());
        return {
          contents: {
            kind: "markdown",
            value:
              entry?.nameLocation
                ? `**${label} ${value}** ✓\n\nDefined at:\n\`${describeResolvedSource(entry.nameLocation.resolved)}:${entry.nameLocation.line + 1}\``
                : `**${label} ${value}** ⚠️\n\nNot found in armor.tbl along the active mod's search path.`,
          },
        };
      } catch {
        // Fall through to the generic per-line hover below.
      }
    }

    if (ship.speciesLine === params.position.line && ship.species) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const entry = getEffectiveSpeciesTable(searchDirs).get(ship.species.toLowerCase());
        return {
          contents: {
            kind: "markdown",
            value: entry?.nameLocation
              ? `**$Species: ${ship.species}** ✓\n\nDefined at:\n\`${describeResolvedSource(entry.nameLocation.resolved)}:${entry.nameLocation.line + 1}\``
              : `**$Species: ${ship.species}** ⚠️\n\nNot found in species_defs.tbl along the active mod's search path.`,
          },
        };
      } catch {
        // Fall through to the generic per-line hover below.
      }
    }

    if (ship.aiClassLine === params.position.line && ship.aiClass) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const entry = getEffectiveAiClassTable(searchDirs).get(ship.aiClass.toLowerCase());
        return {
          contents: {
            kind: "markdown",
            value: entry?.nameLocation
              ? `**$AI Class: ${ship.aiClass}** ✓\n\nDefined at:\n\`${describeResolvedSource(entry.nameLocation.resolved)}:${entry.nameLocation.line + 1}\``
              : `**$AI Class: ${ship.aiClass}** ⚠️\n\nNot found in ai.tbl along the active mod's search path.`,
          },
        };
      } catch {
        // Fall through to the generic per-line hover below.
      }
    }

    if (ship.explosionAnimationsLine === params.position.line && ship.explosionAnimations.length > 0) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const fireballTable = getEffectiveFireballTable(searchDirs);
        const items = ship.explosionAnimations
          .map((n) => `\`${n}\`${resolveFireballReference(fireballTable, n) ? " ✓" : " ⚠️"}`)
          .join(", ");
        return {
          contents: {
            kind: "markdown",
            value: `**$Explosion Animations:**\n\n${items}\n\n(checked against fireball.tbl entries - numeric index or $Unique ID: - along the active mod's search path)`,
          },
        };
      } catch {
        // Fall through to the generic per-line hover below.
      }
    }

    if (ship.targetPriorityGroupsLine === params.position.line && ship.targetPriorityGroups.length > 0) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const objectTypesTable = getEffectiveObjectTypesTable(searchDirs);
        const validNames = new Set(objectTypesDisplayNamesForKind(objectTypesTable, "target-priorities").map((n) => n.toLowerCase()));
        const items = ship.targetPriorityGroups
          .map((n) => `\`${n}\`${validNames.has(n.toLowerCase()) ? " ✓" : " ⚠️"}`)
          .join(", ");
        return {
          contents: {
            kind: "markdown",
            value: `**$Target Priority Groups:**\n\n${items}\n\n(checked against objecttypes.tbl's #Target Priorities section along the active mod's search path)`,
          },
        };
      } catch {
        // Fall through to the generic per-line hover below.
      }
    }

    const hoveredBankList = findBankListAtLine(ship, params.position.line);
    if (hoveredBankList) {
      const isShipLevel = ship.defaultPrimaryBanks?.line === params.position.line || ship.defaultSecondaryBanks?.line === params.position.line;
      const isPrimary =
        ship.defaultPrimaryBanks?.line === params.position.line ||
        ship.subsystems.some((s) => s.defaultPrimaryBanks?.line === params.position.line);

      const token = hoverDoc ? findBankNameTokenAt(hoverDoc, params.position.line, params.position.character) : null;
      if (token && token.name) {
        try {
          const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
          const entry = getEffectiveWeaponsTable(searchDirs).get(token.name.toLowerCase());
          return {
            contents: {
              kind: "markdown",
              value: entry?.nameLocation
                ? `**${token.name}** ✓\n\nDefined at:\n\`${describeResolvedSource(entry.nameLocation.resolved)}:${entry.nameLocation.line + 1}\``
                : `**${token.name}** ⚠️\n\nNot found in weapons.tbl along the active mod's search path.`,
            },
          };
        } catch {
          // Fall through to the whole-line bank summary below.
        }
      }

      const declared = hoveredBankList.weaponNames.length;
      const label = isPrimary ? "$Default PBanks:" : "$Default SBanks:";
      let status = "";
      if (isShipLevel) {
        const pof = resolvePofForShipEntry(params.textDocument.uri, ship);
        const actualCount = isPrimary ? pof?.primaryBankCount ?? null : pof?.secondaryBankCount ?? null;
        status = actualCount === null ? "" : declared === actualCount ? " ✓" : ` ⚠️ (model has ${actualCount})`;
      }
      return {
        contents: {
          kind: "markdown",
          value: `**${label}**${status}\n\nDeclares ${declared} bank(s): ${hoveredBankList.weaponNames.map((n) => (n ? `\`${n}\`` : "`(none)`")).join(", ") || "(none)"}`,
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
      const location = resolvePofLocationForShipEntry(params.textDocument.uri, ship);
      const locationNote = location ? `\n\nModel resolved from:\n\`${describeResolvedSource(location)}\`` : "";
      return {
        contents: {
          kind: "markdown",
          value: `**$Subsystem: ${subsystem.name}** ✓\n\nFound in \`${ship.modelFile}\` (submodel #${match.submodelNumber}).${match.properties ? `\n\nProperties: \`${match.properties}\`` : ""}${turretNote}${locationNote}`,
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
      // The parser's synthetic catch-all for sectionless top-level fields (see
      // LOOSE_SECTION_NAME's doc comment - rank.tbl's optional `[RANK NAMES]` block is
      // the confirmed real case) has an empty name, which the client rejects outright
      // ("name must not be falsy") and fails the whole outline request for the document -
      // not just this one symbol. Every other section name is a real `#Section` header
      // and can't be empty.
      name: section.name === LOOSE_SECTION_NAME ? "(fields outside any #Section)" : section.name,
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

/** One submodel's decoded geometry plus the parent-relative info needed to place/highlight it, as sent to the client for the 3D viewer webview. */
interface SubmodelGeometryPayload {
  name: string;
  /** Index into the returned `submodels` array, or -1 if this is a root submodel. */
  parentIndex: number;
  offset: [number, number, number];
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  /** Which detail (LOD) level's hierarchy this submodel belongs to (see pof/classify.ts), or -1 if none (e.g. debris). */
  detailLevel: number;
  /** Whether this submodel is (or descends from) a debris piece. */
  isDebris: boolean;
}

interface PofGeometryForSubsystemResult {
  modelFile: string;
  /** Index into `submodels` matching the requested `$Subsystem:` name (case-insensitive), or -1 if no submodel name matched. */
  targetSubmodelIndex: number;
  submodels: SubmodelGeometryPayload[];
  /** Number of detail (LOD) levels this model declares - lets the client decide whether to show a detail-level picker at all. */
  detailLevelCount: number;
}

/** Builds the full per-submodel geometry payload for `pof`, highlighting whichever submodel's name matches `targetSubmodelName` (case-insensitive). Shared by both request handlers below - one keyed off a table document + line, the other off a raw POF file path. */
function buildPofGeometryResult(
  pof: PofModel,
  modelFileLabel: string,
  targetSubmodelName: string | null,
): PofGeometryForSubsystemResult {
  const classifications = classifySubmodels(pof);
  const submodels: SubmodelGeometryPayload[] = pof.subobjects.map((s) => {
    const geo = decodeSubmodelGeometry(s.bspData);
    const classification = classifications.get(s.submodelNumber);
    return {
      name: s.name ?? `submodel_${s.submodelNumber}`,
      parentIndex: pof.subobjects.findIndex((p) => p.submodelNumber === s.parentSubmodel),
      offset: [s.offset.x, s.offset.y, s.offset.z],
      positions: geo.positions,
      normals: geo.normals,
      uvs: geo.uvs,
      indices: geo.indices,
      detailLevel: classification?.detailLevel ?? -1,
      isDebris: classification?.isDebris ?? false,
    };
  });

  const targetSubmodelIndex = targetSubmodelName
    ? pof.subobjects.findIndex((s) => (s.name ?? "").toLowerCase() === targetSubmodelName.toLowerCase())
    : -1;

  return { modelFile: modelFileLabel, targetSubmodelIndex, submodels, detailLevelCount: pof.detailLevelRootSubmodels.length };
}

/**
 * Given a document URI + line, finds the ship `$Subsystem:` entry at that exact line
 * (mirrors the subsystem-hover lookup above), resolves and decodes its POF's full
 * geometry, and returns everything the client's 3D viewer webview needs to render
 * every submodel and highlight the one matching this subsystem. Returns null for any
 * line that isn't a `$Subsystem:` entry (or whose model can't be resolved) so the
 * client's go-to-definition provider knows to fall through to normal behavior instead
 * of opening a viewer.
 */
connection.onRequest(
  "fso-lsp/getPofGeometryForSubsystem",
  (params: { uri: string; line: number }): PofGeometryForSubsystemResult | null => {
    const ships = shipEntriesByUri.get(params.uri) ?? [];

    for (const ship of ships) {
      const subsystem = ship.subsystems.find((s) => s.line === params.line);
      if (!subsystem) {
        continue;
      }

      const pof = resolvePofForShipEntry(params.uri, ship);
      if (!pof || !ship.modelFile) {
        return null;
      }

      return buildPofGeometryResult(pof, ship.modelFile, subsystem.name);
    }

    return null;
  },
);

documents.listen(connection);
connection.listen();
