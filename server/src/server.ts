import { fileURLToPath, pathToFileURL } from "url";
import * as path from "path";
import * as fs from "fs";
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
import { validateAgainstSchema, UnknownFieldSeverity } from "./schemaValidator";
import { extractShipEntries, findCurrentShipEntry, ShipEntryInfo, ShipTextureRef, KNOWN_SHIP_FLAGS } from "./tableAnalysis/shipEntries";
import { buildEffectiveShipTable, EffectiveShipEntry } from "./tableAnalysis/mergedShipTable";
import { buildEffectiveShipTemplateTable, EffectiveShipTemplateEntry } from "./tableAnalysis/mergedShipTemplateTable";
import { extractWeaponEntries, WeaponEntryInfo, WeaponTextureRef, WeaponNameListKind } from "./tableAnalysis/weaponEntries";
import { buildEffectiveWeaponsTable, collectDisplayWeaponNames, EffectiveWeaponEntry } from "./tableAnalysis/mergedWeaponsTable";
import {
  renderEffectiveShipFieldTable,
  renderEffectiveWeaponFieldTable,
  computeSharedSourcePrefix,
  stripSharedSourcePrefix,
} from "./tableAnalysis/effectiveEntryFormatter";
import {
  buildEffectiveArmorTable,
  collectAllDamageTypes,
  collectDisplayDamageTypes,
  findDamageTypeLocations,
  EffectiveArmorEntry,
  SourceLocation,
} from "./tableAnalysis/mergedArmorTable";
import { extractSpeciesEntries, SpeciesEntryInfo } from "./tableAnalysis/speciesEntries";
import { extractMissionEntries, MissionEntryInfo } from "./tableAnalysis/missionEntries";
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
import { buildEffectiveTeamColorTable, EffectiveTeamColorEntry } from "./tableAnalysis/mergedColorsTable";
import { buildEffectiveMflashTable, EffectiveMflashEntry } from "./tableAnalysis/mergedMflashTable";
import { buildEffectiveSsmTable, resolveSsmReference, EffectiveSsmEntry } from "./tableAnalysis/mergedSsmTable";
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
import { buildPofFileIndex, PofFileIndexEntry } from "./pofFileIndex";
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
/** Per-document mission-entry cache (.fs2/.fc2 ship-class/weapon-name cross-references), keyed by URI. */
const missionEntriesByUri = new Map<string, MissionEntryInfo>();

/** Matches a .fs2 mission or .fc2 campaign file - the two extensions the "fso-mission" client-side language covers. */
function isMissionFile(uri: string): boolean {
  return /\.(fs2|fc2)$/i.test(uri);
}

/**
 * Matches tables whose real parser makes a `#Section` header entirely optional (or, for
 * ssm.tbl, never checks for one at all) - unlike, say, ships.tbl's hard-`required_string`
 * `#Ship Classes`, so parser.ts's "outside of any #Section block" warning is either a
 * guaranteed or a routinely-expected false positive for these, not a real mistake to flag:
 * - ssm.tbl/*-ssm.tbm (`code/hud/hudartillery.cpp`'s `parse_ssm()`, see ssmEntries.ts) -
 *   genuinely, unconditionally headerless. No header-handling code exists for it at all.
 * - stars.tbl/*-str.tbm (`code/starfield/starfield.cpp`'s `parse_startbl()`) - every
 *   section header (`#Stars`, `#Motion Debris`, `#Bitmaps`, ...) is read via a bare
 *   `optional_string()` with no fallback check, so a modular `-str.tbm` patch routinely
 *   omits them entirely and starts straight in on `$Bitmap:`/`$Sun:` entries - confirmed
 *   against two real Blue Planet files: bp2-str.tbm (headerless `$Sun:`/`$Flare:` block)
 *   AND bp-str.tbm, which goes a step further and pairs each headerless block with its
 *   own bare `#end` closer anyway (real FSO doesn't care; `#end` with nothing open is a
 *   no-op there) - hence suppressing BOTH "outside of any #Section block" AND "#End
 *   found with no open #Section" below, not just the first.
 * - mainhall.tbl/*-hall.tbm (`code/menuui/mainhallmenu.cpp`'s `parse_main_hall_table()`) -
 *   genuinely, unconditionally headerless like ssm.tbl (no `#Section` open at all,
 *   confirmed - just a few leading optional fields then a `$Main Hall`-keyed loop), but
 *   UNLIKE ssm.tbl its lone `#End` at the very end IS required, not optional - so a real
 *   mainhall.tbl/*-hall.tbm always trips "stray #End" too. Confirmed against two real
 *   Blue Planet files (bp-main-hall.tbm, bp2-main-hall.tbm).
 *
 * - nebula.tbl and tips.tbl - both genuinely, unconditionally headerless (a bare
 *   `+Nebula:`/`+Tip:` list with no section wrapper at all, closed by a bare `#End`),
 *   confirmed against real Blue Planet copies of both. Neither table's real modular-
 *   patch suffix (if either even has one) was tracked down, so only the base filename
 *   is matched here.
 *
 * None of stars.tbl/mainhall.tbl/nebula.tbl/tips.tbl are otherwise supported by this
 * project (no dedicated extractor/cross-references for any of them) - this only
 * silences the structural false positives so editing one isn't drowned in noise.
 *
 * - intel.tbl/species.tbl (the legacy alias name)/`*-intl.tbm` (`code/menuui/
 *   techmenu.cpp`'s `parse_intel_table()`) - this resolves a previously-documented
 *   mystery (a real file with this exact shape had no confirmed owner anywhere in
 *   ship.cpp/species_defs parsing/missionui/hud/menuui). Genuinely, unconditionally
 *   headerless in retail (`#Intel` is `optional_string`, never required, and the retail
 *   table has never used one) and closed implicitly by the next `$Entry:` or EOF - no
 *   `#End` at all in a real file, though the parser now also accepts one. See
 *   schemas/intel.ts for the full per-entry grammar.
 */
function isOptionallyHeaderlessTableFile(uri: string): boolean {
  return /(^|[\\/])(ssm|stars|mainhall|nebula|tips|intel|species)\.tbl$|-(ssm|str|hall|intl)\.tbm$/i.test(uri);
}

/**
 * Matches two categories of file this parser's `$Field:`/`+Field:`/`#Section` grammar
 * cannot represent at all, confirmed against the real FSO source - `result.diagnostics`
 * is pure noise for both, same rationale as the mission-file exemption above:
 * - scripting.tbl/*-sct.tbm (`code/scripting/scripting.cpp`'s `script_parse_table()`):
 *   `$Global:`/`$Splash:`/etc. DO use the normal sigil syntax, but their "value" is raw
 *   Lua source wrapped in Lua's own `[[ ... ]]` long-bracket string literal, which can
 *   span arbitrarily many lines containing anything (nested quotes, unbalanced parens,
 *   `--` comments, `$`/`+`/`#`-looking substrings by pure coincidence) - nothing this
 *   line-oriented parser's multiline-continuation heuristics can track correctly.
 * - strings.tbl/tstrings.tbl/*-lcl.tbm/*-tlc.tbm (`code/localization/localize.cpp`'s
 *   `parse_stringstbl_common()`): NOT `$Field:`-shaped at all - after a bare `#default`/
 *   `#<language>` section tag, every entry is just `<index> "<string>" [offset] [offset]`
 *   with no sigil whatsoever, so every line in the file fails every check this parser
 *   knows and gets flagged as unrecognized/outside-any-section.
 * - credits.tbl/*-crd.tbm (`code/menuui/credits.cpp`'s `credits_parse_table()`):
 *   a handful of optional `$Field:` lines at the top (confirmed real, e.g. `$Text scroll
 *   rate:`), then the ENTIRE rest of the file is slurped as raw scroll-credits display
 *   text with no table grammar at all (names, roles, blank lines, bare `XSTR("...", -1)`
 *   markers as literal text) - confirmed against a real Blue Planet credits.tbl that
 *   produced ~300 "Unrecognized line" warnings, one per line of actual credits text.
 * - hud_gauges.tbl/*-hdg.tbm (`code/hud/hudparse.cpp`'s `parse_hud_gauges_tbl()`): a
 *   `#Gauge Config` section's `+Custom:`/etc. sub-blocks use a THIRD field convention
 *   this parser has no concept of at all - bare `Key: value` lines with NO `$`/`+`/`@`
 *   sigil whatsoever (confirmed: `optional_string("Origin:")`, `required_string("Name:")`,
 *   at multiple call sites for different gauge types) - every one of those lines fails
 *   every check this parser knows and is flagged as unrecognized. Confirmed against a
 *   real Blue Planet mv_root-hdg.tbm that produced 700+ diagnostics this way. The
 *   existing hudGaugesSchema's own field-order validation is sacrificed along with the
 *   structural diagnostics by this exclusion, but that schema could only ever have
 *   covered this file's top-level `$Field:`s anyway - the bulk of a real hud_gauges.tbm
 *   is exactly the sigil-less content this parser can't represent.
 *
 * A second, related reason for exclusion (not "the grammar can't represent this at
 * all", but "this table's SECTION BOUNDARIES don't work the way every other table's
 * do"): some tables close a section implicitly, by the START of a specific next known
 * header, rather than requiring an explicit `#End`/table-specific close token in
 * between - a per-table structural quirk parser.ts has no way to know about generically
 * (it would need each table's own list of valid "next section" names). Confirmed
 * against real Blue Planet files for all three:
 * - game_settings.tbl (`code/parse/scpui.h`... no dedicated .cpp found, but confirmed
 *   from the file's own real shape): `#GAME SETTINGS`/`#CAMPAIGN SETTINGS`/etc. are bare
 *   dividers with no scoping semantics at all - only the LAST section in the whole file
 *   has a real closing `#End`. Also explicitly out of scope for schema/field-order
 *   validation already (see schemas/index.ts's doc comment).
 * - messages.tbl (`code/mission/missionmessage.cpp`): confirmed via
 *   `while (required_string_one_of(3, "#Messages", "$Persona:", "#End"))` - `#Personas`
 *   is terminated by EITHER `#End` OR the next section, `#Messages`, starting.
 * - post_processing.tbl: `#Effects` runs until `#Ship Effects` starts, which runs until
 *   `#Light Shafts` starts - only the LAST of the three has a real `#End`.
 *
 * `credits-footer.tbl` (confirmed against a real Between the Ashes file) is the exact
 * same free-scroll-text shape as `credits.tbl` itself (bare XSTR lines, `<br></br>`
 * markup, no `$`/`+`/`@` grammar at all) even though it's a different base filename not
 * read by `credits_parse_table()`'s own hardcoded `"credits.tbl"`/`"*-crd.tbm"` - almost
 * certainly consumed by a mod's own scripting hook rather than the base engine, but the
 * content shape alone is enough to know this parser can't represent it either way.
 *
 * help.tbl/`*-hlp.tbm` (`code/gamehelp/contexthelp.cpp`'s `parse_helptbl()`, mainhall
 * context-help overlays) is a FOURTH field convention this parser has no concept of: a
 * `$`/`+` sigil immediately followed by a bare identifier or space-separated numeric
 * arguments with NO colon separator at all (`+resolutions 1`, `+TEXT 334 700 XSTR(...)`,
 * `+PLINE 6 370 820 ...`) - confirmed against a real Between the Ashes bta-hlp.tbm. This
 * parser's whole field model assumes a colon splits key from value, so every line here
 * either misparses (the colon-based key/value split finds no colon, so the entire rest
 * of the line becomes the "key") or, for the one bare `$<mainhall name>` marker line,
 * trips "outside of any #Section block" since help.tbl has no header at all either.
 *
 * ui.tbl/`*-ui.tbm` (a real Between the Ashes bta-ui.tbm - `#Settings`/`#State
 * Replacement`/`#Background Replacement`/`#Briefing Stage Background Replacement`/
 * `#Medal Placements`, RmlUi `.rml` markup paths and `GS_STATE_SCRIPTING` references),
 * nodemap.tbl (`#Node Map Icons`/`#Node Map Colors`/`#Node Map Systems`), and
 * `*-smap.tbm` (a per-campaign "system map" file, e.g. `system_map_bta1-smap.tbm`'s
 * `#Config`/`#Systems`) are all the same SCPUI-plugin tech-room-map family - no owner
 * found anywhere in FSO's own C++ source for any of them, almost certainly Lua-parsed
 * by SCPUI itself. Their actual `$Field:`/`+Subfield:` grammar IS representable by this
 * parser, but like game_settings.tbl/messages.tbl/post_processing.tbl, only the LAST of
 * several sections has a real `#End` - the same "closes implicitly at the next specific
 * section" shape this parser's generic section model can't express, so all three are
 * excluded here too rather than only partially handled.
 *
 * props.tbl/`*-prp.tbm` (`code/prop/prop.cpp`'s `parse_prop_table()` - decorative
 * background props, a real, confirmed base-engine table, unlike the SCPUI ones above)
 * has the same "implicit close by next section" shape: the optional `#PROP CATEGORIES`
 * section (a `$Name:`/`+Color:` list) has no close token of its own at all - it simply
 * ends whenever `$Name:` stops matching and the required `#PROPS` section begins.
 *
 * traitor.tbl/`*-trtr.tbm` (`code/stats/scoring.cpp`'s `parse_traitor_tbl()` - the
 * "you've been branded a traitor" debriefing text) goes a step further: its two
 * sections, `#Debriefing_info` and `#Traitor Overrides`, are BOTH entirely
 * `optional_string`-gated with NO close token of any kind, ever - not `#End`, not an
 * implicit next-section close either (confirmed: the function just falls straight from
 * one `if (optional_string(...))` block into the next). A real file simply never closes
 * either section, which this parser's section model has no way to represent short of a
 * per-table "this section never closes" rule - excluded like the others above instead.
 */
function isUnsupportedGrammarFile(uri: string): boolean {
  return /(^|[\\/])(scripting|strings|tstrings|credits|credits-footer|hud_gauges|game_settings|messages|post_processing|help|ui|nodemap|props|traitor)\.tbl$|-(sct|lcl|tlc|crd|hdg|hlp|ui|smap|prp|trtr)\.tbm$/i.test(
    uri,
  );
}

/** Per-document species-entry cache (currently just `$Default IFF:`), keyed by URI. */
const speciesEntriesByUri = new Map<string, SpeciesEntryInfo[]>();

/**
 * Cached `fsoLsp.*` settings - re-fetched (see refreshConfiguration() below) whenever the
 * client reports a configuration change, rather than pulled fresh on every validation/
 * hover pass, so those hot paths stay synchronous.
 */
let unknownFieldSeverity: UnknownFieldSeverity = "off";
let trimSharedSourcePrefix = true;
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

/**
 * "openFiles" (default) only validates documents the editor actually has open - the
 * original, cheap behavior. "wholeMod" additionally scans every loose `.tbl`/`.tbm` file
 * across the active mod's search path (see runWholeModValidation()) so cross-reference
 * problems show up in the Problems panel even for files nobody has opened yet - useful
 * before a release, at the cost of one filesystem walk per rescan.
 */
type ValidationScope = "openFiles" | "wholeMod";
let validationScope: ValidationScope = "openFiles";

connection.onInitialize((params: InitializeParams): InitializeResult => {
  hasConfigurationCapability = !!params.capabilities.workspace?.configuration;
  hasWorkspaceFolderCapability = !!params.capabilities.workspace?.workspaceFolders;
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { triggerCharacters: ["$", "+", "@", "#"] },
      hoverProvider: true,
      documentSymbolProvider: true,
      definitionProvider: true,
      declarationProvider: true,
      workspace: { workspaceFolders: { supported: true } },
    },
  };
});

/** Pulls the current `fsoLsp.*` settings from the client, if it supports configuration requests at all. */
async function refreshConfiguration(): Promise<void> {
  if (!hasConfigurationCapability) {
    return;
  }
  try {
    const config = await connection.workspace.getConfiguration({ section: "fsoLsp" });
    const severity = config?.unknownFieldSeverity;
    unknownFieldSeverity = severity === "warning" || severity === "error" ? severity : "off";
    trimSharedSourcePrefix = config?.trimSharedSourcePrefix !== false;
    validationScope = config?.validationScope === "wholeMod" ? "wholeMod" : "openFiles";
  } catch {
    unknownFieldSeverity = "off";
    trimSharedSourcePrefix = true;
    validationScope = "openFiles";
  }
}

/**
 * Every URI `runWholeModValidation()` most recently published diagnostics for, so a
 * later rescan (or a switch back to "openFiles") knows which now-stale entries to clear
 * - an LSP diagnostic published for a URI stays shown until something explicitly
 * republishes an empty array for it, so simply stopping the scan would leave every
 * whole-mod finding stuck in the Problems panel forever.
 */
const wholeModValidatedUris = new Set<string>();

/**
 * Whether `documents` (the live TextDocuments manager) already has an open document for
 * `uri`, tolerant of the same Windows drive-letter uri-encoding mismatch `getByUri()`
 * works around below (a uri this function builds itself via `pathToFileURL().toString()`
 * doesn't necessarily match the encoding vscode-languageclient used when it told the
 * server the document was opened). Skipping this normalization would risk the whole-mod
 * scan treating a genuinely open document as closed on Windows, re-validating it from
 * stale on-disk content instead of leaving its live diagnostics alone.
 */
function isDocumentOpen(uri: string): boolean {
  if (documents.get(uri)) {
    return true;
  }
  let normalizedTarget: string;
  try {
    normalizedTarget = decodeURIComponent(uri).toLowerCase();
  } catch {
    return false;
  }
  for (const doc of documents.all()) {
    try {
      if (decodeURIComponent(doc.uri).toLowerCase() === normalizedTarget) {
        return true;
      }
    } catch {
      // A uri that fails to percent-decode can't match a well-formed uri either way.
    }
  }
  return false;
}

/**
 * Finds every loose `.tbl`/`.tbm` file across a search path's `data/tables` directories -
 * mirrors listMatchingFiles()'s single-directory `data/tables` scan (see resolver.ts) but
 * collects every table file rather than ones matching one specific `.tbm` suffix. VP-
 * packed tables are deliberately out of scope here: a mod under active development (the
 * case this scan is for) keeps its own tables loose, and enumerating every VP's contents
 * on top of the loose scan would be a much bigger, slower feature for little real benefit.
 */
function findAllLooseTableFiles(searchDirs: string[]): string[] {
  const files: string[] = [];
  for (const dir of searchDirs) {
    const tablesDir = path.join(dir, "data", "tables");
    try {
      for (const f of fs.readdirSync(tablesDir)) {
        // Script/localization tables are never validated (see
        // isUnsupportedGrammarFile()) - skip reading them here too rather than pay for
        // a pointless parse.
        if (/\.(tbl|tbm)$/i.test(f) && !isUnsupportedGrammarFile(f)) {
          files.push(path.join(tablesDir, f));
        }
      }
    } catch {
      // No loose data/tables directory in this search-path entry - fine, skip it.
    }
  }
  return files;
}

/**
 * Scans every workspace folder's active mod for loose `.tbl`/`.tbm` files and validates
 * each one not already open (an open document's diagnostics are already kept live by
 * documents.onDidChangeContent below, including any unsaved edits this on-disk read
 * would miss). No-op when validationScope isn't "wholeMod", or when the client doesn't
 * support the workspace-folders request at all.
 */
async function runWholeModValidation(): Promise<void> {
  if (validationScope !== "wholeMod" || !hasWorkspaceFolderCapability) {
    return;
  }

  const newUris = new Set<string>();
  try {
    const folders = await connection.workspace.getWorkspaceFolders();
    for (const folder of folders ?? []) {
      let searchDirs: string[];
      try {
        searchDirs = buildSearchPath(fileURLToPath(folder.uri));
      } catch {
        continue;
      }
      for (const filePath of findAllLooseTableFiles(searchDirs)) {
        const uri = pathToFileURL(filePath).toString();
        newUris.add(uri);
        if (isDocumentOpen(uri)) {
          continue;
        }
        let content: string;
        try {
          content = fs.readFileSync(filePath, "utf8");
        } catch {
          continue;
        }
        validateAndPublish(TextDocument.create(uri, "fso-table", 1, content));
      }
    }
  } catch {
    // Can't enumerate workspace folders this time - leave whatever was already published.
    return;
  }

  for (const staleUri of wholeModValidatedUris) {
    if (!newUris.has(staleUri) && !isDocumentOpen(staleUri)) {
      connection.sendDiagnostics({ uri: staleUri, diagnostics: [] });
    }
  }
  wholeModValidatedUris.clear();
  for (const uri of newUris) {
    wholeModValidatedUris.add(uri);
  }
}

/** Clears every diagnostic runWholeModValidation() published for a file that isn't also currently open - used when the scope switches away from "wholeMod". */
function clearWholeModDiagnostics(): void {
  for (const uri of wholeModValidatedUris) {
    if (!isDocumentOpen(uri)) {
      connection.sendDiagnostics({ uri, diagnostics: [] });
    }
  }
  wholeModValidatedUris.clear();
}

connection.onInitialized(() => {
  void refreshConfiguration().then(() => {
    for (const document of documents.all()) {
      validateAndPublish(document);
    }
    void runWholeModValidation();
  });
});

connection.onDidChangeConfiguration(() => {
  const previousScope = validationScope;
  void refreshConfiguration().then(() => {
    for (const document of documents.all()) {
      validateAndPublish(document);
    }
    if (validationScope === "wholeMod") {
      void runWholeModValidation();
    } else if (previousScope === "wholeMod") {
      clearWholeModDiagnostics();
    }
  });
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
 * True for a filename-valued field's value that FSO's own `VALID_FNAME()` (pstypes.h)
 * treats as "no file set": empty, `none`, or `<none>` (all case-insensitive) - confirmed
 * against a real bp-wep.tbm using `$Model file: none` (VALID_FNAME literally checks
 * `stricmp(x, "none") != 0 && stricmp(x, "<none>") != 0`, on top of the empty-string
 * check). Filename fields across ships.tbl/weapons.tbl (POF/model files, textures,
 * sounds) all funnel through the same VALID_FNAME() gate in the real parser, so this one
 * helper covers all of them rather than each field needing its own sentinel list.
 */
function isUnsetFileValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "" || v === "none" || v === "<none>";
}

/**
 * Resolves a sound-referencing field's value to its sounds.tbl `$Name:` definition
 * site(s), mirroring findSoundHover()'s lookup (always the merged table's `"game"` kind -
 * see [[fso-gamesnd-lookup]] project memory) but returning LSP Locations instead of a
 * hover string. `<none>`/`none`/empty/`-1` are the same "no sound set" sentinels
 * computeSoundDiagnostics() skips - nothing to jump to for those.
 */
function resolveSoundDefinition(documentUri: string, value: string): Location[] | null {
  if (isUnsetFileValue(value) || value === "-1") {
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
  if (isUnsetFileValue(value)) {
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

    if (ship.countermeasureTypeLine === line && ship.countermeasureType) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const entry = getEffectiveWeaponsTable(searchDirs).get(ship.countermeasureType.toLowerCase());
        return entry?.allLocations?.length ? entry.allLocations.map(toDefinitionLocation) : null;
      } catch {
        return null;
      }
    }

    if (ship.defaultTeamLine === line && ship.defaultTeam && ship.defaultTeam.toLowerCase() !== "none") {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const entry = getEffectiveTeamColorTable(searchDirs).get(ship.defaultTeam.toLowerCase());
        return entry?.allLocations?.length ? entry.allLocations.map(toDefinitionLocation) : null;
      } catch {
        return null;
      }
    }

    if (ship.useTemplateLine === line && ship.useTemplate) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const entry = getEffectiveShipTemplateTable(searchDirs).get(ship.useTemplate.toLowerCase());
        return entry?.allLocations?.length ? entry.allLocations.map(toDefinitionLocation) : null;
      } catch {
        return null;
      }
    }

    if (ship.useShipAsTemplateLine === line && ship.useShipAsTemplate) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const entry = getEffectiveShipTable(searchDirs).get(ship.useShipAsTemplate.toLowerCase());
        return entry?.allLocations?.length ? entry.allLocations.map(toDefinitionLocation) : null;
      } catch {
        return null;
      }
    }

    const shipIffColorRef = findRefAtLine(ship.iffColorRefs, line);
    if (shipIffColorRef) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const entry = getEffectiveIffTable(searchDirs).get(shipIffColorRef.value.toLowerCase());
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

    if (ship.flagsLine === line && ship.flags.length > 0) {
      const doc = documents.get(documentUri);
      const token = doc ? findNameListTokenAt(doc, line, params.position.character) : null;
      // A recognized engine flag (see KNOWN_SHIP_FLAGS) has no table entry to jump to -
      // only a ship-type name does, so a miss here falls through to null rather than an
      // error (this is the expected, common case, not a failure).
      if (!token || !token.name || KNOWN_SHIP_FLAGS.has(token.name.toLowerCase())) {
        return null;
      }
      try {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const entry = getEffectiveObjectTypesTable(searchDirs).get(objectTypesMapKey("ship-types", token.name));
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

    if (weapon.armorTypeLine === line && weapon.armorType) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const entry = getEffectiveArmorTable(searchDirs).get(weapon.armorType.toLowerCase());
        return entry?.allLocations?.length ? entry.allLocations.map(toDefinitionLocation) : null;
      } catch {
        return null;
      }
    }

    if (weapon.muzzleflashLine === line && weapon.muzzleflash) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const entry = getEffectiveMflashTable(searchDirs).get(weapon.muzzleflash.toLowerCase());
        return entry?.allLocations?.length ? entry.allLocations.map(toDefinitionLocation) : null;
      } catch {
        return null;
      }
    }

    if (weapon.ssmClassLine === line && weapon.ssmClass) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const entry = resolveSsmReference(getEffectiveSsmTable(searchDirs), weapon.ssmClass);
        return entry?.allLocations?.length ? entry.allLocations.map(toDefinitionLocation) : null;
      } catch {
        return null;
      }
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

  const mission = missionEntriesByUri.get(documentUri);
  if (mission) {
    const shipClass = mission.shipClassRefs.find((r) => r.line === line);
    if (shipClass) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const entry = getEffectiveShipTable(searchDirs).get(shipClass.value.toLowerCase());
        return entry?.allLocations?.length ? entry.allLocations.map(toDefinitionLocation) : null;
      } catch {
        return null;
      }
    }

    const missionToken = findMissionRefTokenAt(mission, documents.get(documentUri), line, params.position.character);
    if (missionToken) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const entry =
          missionToken.kind === "ship"
            ? getEffectiveShipTable(searchDirs).get(missionToken.name.toLowerCase())
            : getEffectiveWeaponsTable(searchDirs).get(missionToken.name.toLowerCase());
        return entry?.allLocations?.length ? entry.allLocations.map(toDefinitionLocation) : null;
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Finds the ship-class-or-weapon name token (if any) at `line`/`character` within a
 * mission's `$Ship Choices:`/`+Weaponry Pool:`/`+Primary Banks:`/`+Secondary Banks:`
 * lists - reuses findBankNameTokenAt() since these are the exact same
 * `( "Name" ... )`-shaped lists ships.tbl's own bank fields use, just spread across
 * (frequently many) physical lines rather than always sitting on the field's own line -
 * see MissionNameRef's doc comment for why each ref already carries its own real line.
 */
function findMissionRefTokenAt(
  mission: MissionEntryInfo,
  doc: TextDocument | undefined,
  line: number,
  character: number,
): { kind: "ship" | "weapon"; name: string } | null {
  if (!doc) {
    return null;
  }
  if (mission.shipChoiceRefs.some((r) => r.line === line)) {
    const token = findBankNameTokenAt(doc, line, character);
    return token?.name ? { kind: "ship", name: token.name } : null;
  }
  if (mission.weaponBankRefs.some((r) => r.line === line) || mission.weaponryPoolRefs.some((r) => r.line === line)) {
    const token = findBankNameTokenAt(doc, line, character);
    return token?.name ? { kind: "weapon", name: token.name } : null;
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
  missionEntriesByUri.delete(e.document.uri);
  if (validationScope === "wholeMod" && wholeModValidatedUris.has(e.document.uri)) {
    // Already covered by the whole-mod scan - re-validate from its on-disk (saved)
    // content instead of wiping its diagnostics, so closing a file with real problems
    // doesn't make them vanish from the Problems panel until the next rescan happens to
    // run for an unrelated reason.
    void runWholeModValidation();
  } else {
    connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
  }
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
  effectiveShipTemplateTableCache.clear();
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
  effectiveTeamColorTableCache.clear();
  effectiveMflashTableCache.clear();
  effectiveSsmTableCache.clear();
  textureIndexCache.clear();
  textureNamesSortedCache.clear();
  pofFileIndexCache.clear();
  pofFileNamesSortedCache.clear();
  void runWholeModValidation();
});

function validateAndPublish(document: TextDocument): void {
  if (isUnsupportedGrammarFile(document.uri)) {
    // Skip the entire pipeline, not just result.diagnostics - see
    // isUnsupportedGrammarFile()'s doc comment. Running ship/weapon extraction against
    // raw Lua or bare-pair strings.tbl content risks its own spurious cross-reference
    // diagnostics from coincidental matches, on top of the structural noise; nothing in
    // either file type is a real ship/weapon/etc. entry this project understands, so
    // there's nothing worth extracting for hover/go-to-definition either.
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    return;
  }

  const result = parseTable(document.getText());
  const isMission = isMissionFile(document.uri);
  const isOptionallyHeaderless = isOptionallyHeaderlessTableFile(document.uri);
  parsedByUri.set(document.uri, result);
  shipEntriesByUri.set(document.uri, extractShipEntries(result.sections));
  weaponEntriesByUri.set(document.uri, extractWeaponEntries(result.sections));
  speciesEntriesByUri.set(document.uri, extractSpeciesEntries(result.sections));
  missionEntriesByUri.set(document.uri, extractMissionEntries(result.sections));

  const schema = findSchemaForFile(document.uri);
  const schemaDiagnostics = schema ? validateAgainstSchema(result.sections, schema, unknownFieldSeverity) : [];
  const ships = shipEntriesByUri.get(document.uri) ?? [];
  const weapons = weaponEntriesByUri.get(document.uri) ?? [];
  const species = speciesEntriesByUri.get(document.uri) ?? [];
  const bankCountDiagnostics = computeBankCountDiagnostics(document.uri, ships);
  const bankWeaponNameDiagnostics = computeBankWeaponNameDiagnostics(document.uri, ships);
  const shipModelDiagnostics = computeShipModelDiagnostics(document.uri, ships);
  const weaponModelDiagnostics = computeWeaponModelDiagnostics(document.uri, weapons);
  const armorTypeDiagnostics = computeArmorTypeDiagnostics(document.uri, ships);
  const speciesDiagnostics = computeSpeciesDiagnostics(document.uri, ships);
  const aiClassDiagnostics = computeAiClassDiagnostics(document.uri, ships);
  const explosionAnimationDiagnostics = computeExplosionAnimationDiagnostics(document.uri, ships);
  const targetPriorityGroupsDiagnostics = computeTargetPriorityGroupsDiagnostics(document.uri, ships);
  const shipFlagsDiagnostics = computeShipFlagsDiagnostics(document.uri, ships);
  const countermeasureTypeDiagnostics = computeCountermeasureTypeDiagnostics(document.uri, ships);
  const shipTemplateDiagnostics = computeShipTemplateDiagnostics(document.uri, ships);
  const shipIffColorDiagnostics = computeShipIffColorDiagnostics(document.uri, ships);
  const defaultTeamDiagnostics = computeDefaultTeamDiagnostics(document.uri, ships);
  const iffDiagnostics = computeIffDiagnostics(document.uri, species);
  const damageTypeDiagnostics = computeDamageTypeDiagnostics(document.uri, weapons);
  const weaponArmorTypeDiagnostics = computeWeaponArmorTypeDiagnostics(document.uri, weapons);
  const conditionalImpactArmorDiagnostics = computeConditionalImpactArmorDiagnostics(document.uri, weapons);
  const muzzleflashDiagnostics = computeMuzzleflashDiagnostics(document.uri, weapons);
  const ssmDiagnostics = computeSsmDiagnostics(document.uri, weapons);
  const weaponSubstituteDiagnostics = computeWeaponSubstituteDiagnostics(document.uri, weapons);
  const weaponNameListDiagnostics = computeWeaponNameListDiagnostics(document.uri, weapons);
  const textureDiagnostics = computeTextureDiagnostics(document.uri, ships, weapons);
  const soundDiagnostics = computeSoundDiagnostics(document.uri, ships, weapons);

  const diagnostics: LspDiagnostic[] = [
    // parseTable()'s own structural diagnostics ("Unrecognized line", "not closed with
    // #End", ...) assume .tbl/.tbm grammar - a real .fs2's SEXP-based #Events/#Goals and
    // multi-line vector/matrix continuations (neither of which this parser attempts to
    // understand) trip "Unrecognized line" on well over 100 perfectly valid lines in a
    // typical mission (confirmed against a real thrash_test.fs2), and most sections
    // don't close with a literal #End the way every table does. This parser is only used
    // for mission files to grab the #Objects/#Players cross-references below, not to
    // validate mission structure, so none of its own diagnostics apply there.
    ...(isMission
      ? []
      : (isOptionallyHeaderless
          ? result.diagnostics.filter(
              (d) =>
                !d.message.endsWith("appears outside of any #Section block") &&
                d.message !== "#End found with no open #Section",
            )
          : result.diagnostics
        ).filter(
          // $Player Weapon Precedence: is a REAL top-level weapons.tbl field read
          // AFTER the #Primary/#Secondary Weapons section's own #End (confirmed
          // against weapons.cpp: `stuff_string_list(Player_weapon_precedence_names)`
          // sits right after `required_string("#End")` in parse_weaponstbl()) -
          // genuinely outside any #Section block per the real grammar too, not a
          // mistake worth flagging. Filtered narrowly by exact message text (not a
          // whole-file exemption) since every other weapons.tbl field IS properly
          // scoped and should still get this warning if it's ever really misplaced.
          //
          // Same real grammar shape for asteroid.tbl's $Impact Explosion Effect:/
          // $Impact Explosion:/$Impact Explosion Radius: - confirmed against
          // asteroid.cpp's asteroid_parse_tbl(): all three are read right after the
          // #Asteroid Types section's own required_string("#End") (a real Between the
          // Ashes asteroid.tbl uses this shape).
          (d) =>
            d.message !== '"$Player Weapon Precedence" appears outside of any #Section block' &&
            d.message !== '"$Impact Explosion Effect" appears outside of any #Section block' &&
            d.message !== '"$Impact Explosion" appears outside of any #Section block' &&
            d.message !== '"$Impact Explosion Radius" appears outside of any #Section block',
        )),
    ...schemaDiagnostics,
    ...bankCountDiagnostics,
    ...bankWeaponNameDiagnostics,
    ...shipModelDiagnostics,
    ...weaponModelDiagnostics,
    ...armorTypeDiagnostics,
    ...speciesDiagnostics,
    ...aiClassDiagnostics,
    ...explosionAnimationDiagnostics,
    ...targetPriorityGroupsDiagnostics,
    ...shipFlagsDiagnostics,
    ...countermeasureTypeDiagnostics,
    ...shipTemplateDiagnostics,
    ...shipIffColorDiagnostics,
    ...defaultTeamDiagnostics,
    ...iffDiagnostics,
    ...damageTypeDiagnostics,
    ...weaponArmorTypeDiagnostics,
    ...conditionalImpactArmorDiagnostics,
    ...muzzleflashDiagnostics,
    ...ssmDiagnostics,
    ...weaponSubstituteDiagnostics,
    ...weaponNameListDiagnostics,
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

/** Cache of the merged/effective `#Ship Templates` view, mirroring effectiveShipTableCache. */
const effectiveShipTemplateTableCache = new Map<string, Map<string, EffectiveShipTemplateEntry>>();

function getEffectiveShipTemplateTable(searchDirs: string[]): Map<string, EffectiveShipTemplateEntry> {
  const key = searchDirs.join("|");
  const cached = effectiveShipTemplateTableCache.get(key);
  if (cached) {
    return cached;
  }
  const table = buildEffectiveShipTemplateTable(searchDirs);
  effectiveShipTemplateTableCache.set(key, table);
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
    if (!modelFile || isUnsetFileValue(modelFile)) {
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
    if (!modelFile || isUnsetFileValue(modelFile)) {
      return null;
    }
    return resolveModelFile(searchDirs, modelFile);
  } catch {
    return null;
  }
}

/** Same resolution as resolvePofForShipEntry(), but for `$Cockpit POF file:` - the 3D cockpit interior model. */
function resolvePofForShipCockpitModel(documentUri: string, ship: ShipEntryInfo): PofModel | null {
  try {
    const filePath = fileURLToPath(documentUri);
    const searchDirs = buildSearchPath(filePath);
    const effective = getEffectiveShipTable(searchDirs).get(ship.name.toLowerCase());
    const cockpitModelFile = effective?.cockpitModelFile ?? ship.cockpitModelFile;
    if (!cockpitModelFile || isUnsetFileValue(cockpitModelFile)) {
      return null;
    }
    const resolved = resolveModelFile(searchDirs, cockpitModelFile);
    if (!resolved) {
      return null;
    }
    return loadPofCached(resolved);
  } catch {
    return null;
  }
}

/** Same resolution as resolvePofForShipEntry(), but for `$POF file Techroom:` - the separate POF shown in the tech room / ship database. */
function resolvePofForShipTechModel(documentUri: string, ship: ShipEntryInfo): PofModel | null {
  try {
    const filePath = fileURLToPath(documentUri);
    const searchDirs = buildSearchPath(filePath);
    const effective = getEffectiveShipTable(searchDirs).get(ship.name.toLowerCase());
    const techModel = effective?.techModel ?? ship.techModel;
    if (!techModel || isUnsetFileValue(techModel)) {
      return null;
    }
    const resolved = resolveModelFile(searchDirs, techModel);
    if (!resolved) {
      return null;
    }
    return loadPofCached(resolved);
  } catch {
    return null;
  }
}

/** Same resolution as resolvePofForShipEntry(), but for `$POF target file:` - a low-detail model substituted in the HUD target monitor. */
function resolvePofForShipHudTargetModel(documentUri: string, ship: ShipEntryInfo): PofModel | null {
  try {
    const filePath = fileURLToPath(documentUri);
    const searchDirs = buildSearchPath(filePath);
    const effective = getEffectiveShipTable(searchDirs).get(ship.name.toLowerCase());
    const hudTargetModelFile = effective?.hudTargetModelFile ?? ship.hudTargetModelFile;
    if (!hudTargetModelFile || isUnsetFileValue(hudTargetModelFile)) {
      return null;
    }
    const resolved = resolveModelFile(searchDirs, hudTargetModelFile);
    if (!resolved) {
      return null;
    }
    return loadPofCached(resolved);
  } catch {
    return null;
  }
}

/** Same resolution as resolvePofForShipEntry(), but for `+Generic Debris POF file:` - the debris-chunk model used when this ship explodes. */
function resolvePofForShipGenericDebrisModel(documentUri: string, ship: ShipEntryInfo): PofModel | null {
  try {
    const filePath = fileURLToPath(documentUri);
    const searchDirs = buildSearchPath(filePath);
    const effective = getEffectiveShipTable(searchDirs).get(ship.name.toLowerCase());
    const genericDebrisModelFile = effective?.genericDebrisModelFile ?? ship.genericDebrisModelFile;
    if (!genericDebrisModelFile || isUnsetFileValue(genericDebrisModelFile)) {
      return null;
    }
    const resolved = resolveModelFile(searchDirs, genericDebrisModelFile);
    if (!resolved) {
      return null;
    }
    return loadPofCached(resolved);
  } catch {
    return null;
  }
}

/**
 * Flags a ship's `$Cockpit POF file:`/`$POF file Techroom:`/`$POF target file:`/
 * `+Generic Debris POF file:` when it can't be resolved anywhere along the active mod's
 * search path - mirrors computeWeaponModelDiagnostics() for weapons.tbl's equivalent
 * fields. `$POF file:` itself is deliberately NOT checked here - it predates this
 * function and is instead surfaced via the $Subsystem: hover/3D-viewer error paths.
 */
function computeShipModelDiagnostics(documentUri: string, ships: ShipEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];

  for (const ship of ships) {
    if (ship.cockpitModelFile && ship.cockpitModelFileLine !== null && !isUnsetFileValue(ship.cockpitModelFile)) {
      if (!resolvePofForShipCockpitModel(documentUri, ship)) {
        diagnostics.push({
          line: ship.cockpitModelFileLine,
          startCol: 0,
          endCol: 1000,
          message: `$Cockpit POF file: "${ship.cockpitModelFile}" could not be resolved along the active mod's search path`,
          severity: "warning",
        });
      }
    }

    if (ship.techModel && ship.techModelLine !== null && !isUnsetFileValue(ship.techModel)) {
      if (!resolvePofForShipTechModel(documentUri, ship)) {
        diagnostics.push({
          line: ship.techModelLine,
          startCol: 0,
          endCol: 1000,
          message: `$POF file Techroom: "${ship.techModel}" could not be resolved along the active mod's search path`,
          severity: "warning",
        });
      }
    }

    if (
      ship.hudTargetModelFile &&
      ship.hudTargetModelFileLine !== null &&
      !isUnsetFileValue(ship.hudTargetModelFile)
    ) {
      if (!resolvePofForShipHudTargetModel(documentUri, ship)) {
        diagnostics.push({
          line: ship.hudTargetModelFileLine,
          startCol: 0,
          endCol: 1000,
          message: `$POF target file: "${ship.hudTargetModelFile}" could not be resolved along the active mod's search path`,
          severity: "warning",
        });
      }
    }

    if (
      ship.genericDebrisModelFile &&
      ship.genericDebrisModelFileLine !== null &&
      !isUnsetFileValue(ship.genericDebrisModelFile)
    ) {
      if (!resolvePofForShipGenericDebrisModel(documentUri, ship)) {
        diagnostics.push({
          line: ship.genericDebrisModelFileLine,
          startCol: 0,
          endCol: 1000,
          message: `+Generic Debris POF file: "${ship.genericDebrisModelFile}" could not be resolved along the active mod's search path`,
          severity: "warning",
        });
      }
    }
  }

  return diagnostics;
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
    if (!modelFile || isUnsetFileValue(modelFile)) {
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

/** Same resolution as resolvePofForWeaponEntry(), but for `$Tech Model:` - the separate POF shown in the tech room / weapon database. */
function resolvePofForWeaponTechModel(documentUri: string, weapon: WeaponEntryInfo): PofModel | null {
  try {
    const filePath = fileURLToPath(documentUri);
    const searchDirs = buildSearchPath(filePath);
    const effective = getEffectiveWeaponsTable(searchDirs).get(weapon.name.toLowerCase());
    const techModel = effective?.techModel ?? weapon.techModel;
    if (!techModel || isUnsetFileValue(techModel)) {
      return null;
    }
    const resolved = resolveModelFile(searchDirs, techModel);
    if (!resolved) {
      return null;
    }
    return loadPofCached(resolved);
  } catch {
    return null;
  }
}

/** Same resolution as resolvePofForWeaponEntry(), but for `$External Model File:` - the POF substituted for `$Model file:` in the external/cockpit view. */
function resolvePofForWeaponExternalModel(documentUri: string, weapon: WeaponEntryInfo): PofModel | null {
  try {
    const filePath = fileURLToPath(documentUri);
    const searchDirs = buildSearchPath(filePath);
    const effective = getEffectiveWeaponsTable(searchDirs).get(weapon.name.toLowerCase());
    const externalModelFile = effective?.externalModelFile ?? weapon.externalModelFile;
    if (!externalModelFile || isUnsetFileValue(externalModelFile)) {
      return null;
    }
    const resolved = resolveModelFile(searchDirs, externalModelFile);
    if (!resolved) {
      return null;
    }
    return loadPofCached(resolved);
  } catch {
    return null;
  }
}

/**
 * Flags a weapon's `$Model file:`/`$Tech Model:`/`$External Model File:` when it can't
 * be resolved anywhere along the active mod's search path - a typo'd or missing model
 * filename. Only checked for fields physically present in this document, same scoping
 * rationale as computeBankCountDiagnostics().
 */
function computeWeaponModelDiagnostics(documentUri: string, weapons: WeaponEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];

  for (const weapon of weapons) {
    if (weapon.modelFile && weapon.modelFileLine !== null && !isUnsetFileValue(weapon.modelFile)) {
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

    if (weapon.techModel && weapon.techModelLine !== null && !isUnsetFileValue(weapon.techModel)) {
      const techPof = resolvePofForWeaponTechModel(documentUri, weapon);
      if (!techPof) {
        diagnostics.push({
          line: weapon.techModelLine,
          startCol: 0,
          endCol: 1000,
          message: `$Tech Model: "${weapon.techModel}" could not be resolved along the active mod's search path`,
          severity: "warning",
        });
      }
    }

    if (
      weapon.externalModelFile &&
      weapon.externalModelFileLine !== null &&
      !isUnsetFileValue(weapon.externalModelFile)
    ) {
      const externalPof = resolvePofForWeaponExternalModel(documentUri, weapon);
      if (!externalPof) {
        diagnostics.push({
          line: weapon.externalModelFileLine,
          startCol: 0,
          endCol: 1000,
          message: `$External Model File: "${weapon.externalModelFile}" could not be resolved along the active mod's search path`,
          severity: "warning",
        });
      }
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
 * Caches for colors.tbl/mflash.tbl/ssm.tbl - unlike the group above, each of these IS a
 * confirmed cross-reference target: a ship's `$Default Team:` (colors.tbl), a weapon's
 * `$Muzzleflash:` (mflash.tbl), and a weapon's `$SSM:` (ssm.tbl) - see
 * shipEntries.ts/weaponEntries.ts.
 */
const effectiveTeamColorTableCache = new Map<string, Map<string, EffectiveTeamColorEntry>>();
const effectiveMflashTableCache = new Map<string, Map<string, EffectiveMflashEntry>>();
const effectiveSsmTableCache = new Map<string, Map<string, EffectiveSsmEntry>>();

function getEffectiveTeamColorTable(searchDirs: string[]): Map<string, EffectiveTeamColorEntry> {
  return cachedTable(effectiveTeamColorTableCache, searchDirs, buildEffectiveTeamColorTable);
}
function getEffectiveMflashTable(searchDirs: string[]): Map<string, EffectiveMflashEntry> {
  return cachedTable(effectiveMflashTableCache, searchDirs, buildEffectiveMflashTable);
}
function getEffectiveSsmTable(searchDirs: string[]): Map<string, EffectiveSsmEntry> {
  return cachedTable(effectiveSsmTableCache, searchDirs, buildEffectiveSsmTable);
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

/** Cache of the `.pof` filename index (see pofFileIndex.ts), same cache-key/invalidation convention as textureIndexCache above. */
const pofFileIndexCache = new Map<string, Map<string, PofFileIndexEntry>>();

function getPofFileIndex(searchDirs: string[]): Map<string, PofFileIndexEntry> {
  const key = searchDirs.join("|");
  const cached = pofFileIndexCache.get(key);
  if (cached) {
    return cached;
  }
  const index = buildPofFileIndex(searchDirs);
  pofFileIndexCache.set(key, index);
  return index;
}

/** Sorted, on-disk-cased `.pof` filename list - same rationale as textureNamesSortedCache above. */
const pofFileNamesSortedCache = new Map<string, string[]>();

function getSortedPofFileNames(searchDirs: string[]): string[] {
  const key = searchDirs.join("|");
  const cached = pofFileNamesSortedCache.get(key);
  if (cached) {
    return cached;
  }
  const names = Array.from(getPofFileIndex(searchDirs).values())
    .map((e) => e.displayName)
    .sort();
  pofFileNamesSortedCache.set(key, names);
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
 * Cross-table check: a ship's `$Countermeasure type:` should name a weapons.tbl weapon
 * (confirmed against ship.cpp: `weapon_info_lookup()`; non-beam only, but a beam given
 * here is an engine warning rather than a hard failure, so this stays a warning too).
 */
function computeCountermeasureTypeDiagnostics(documentUri: string, ships: ShipEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  let weaponsTable: Map<string, EffectiveWeaponEntry> | null = null;

  for (const ship of ships) {
    if (!ship.countermeasureType || ship.countermeasureTypeLine === null) {
      continue;
    }
    try {
      if (!weaponsTable) {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        weaponsTable = getEffectiveWeaponsTable(searchDirs);
      }
      if (!weaponsTable.has(ship.countermeasureType.toLowerCase())) {
        diagnostics.push({
          line: ship.countermeasureTypeLine,
          startCol: 0,
          endCol: 1000,
          message: `$Countermeasure type: "${ship.countermeasureType}" was not found as a weapons.tbl weapon (checked across the active mod's search path)`,
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
 * Cross-table checks: a ship class's `+Use Template:` should name a `#Ship Templates`
 * entry's `$Template:`; `+Use Ship as Template:` should name another ship class's
 * `$Name:` (confirmed against ship.cpp: `ship_template_lookup()`/`ship_info_lookup_sub()`
 * respectively - two distinct target tables despite the similar field names).
 */
function computeShipTemplateDiagnostics(documentUri: string, ships: ShipEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  let templateTable: Map<string, EffectiveShipTemplateEntry> | null = null;
  let shipTable: Map<string, EffectiveShipEntry> | null = null;

  for (const ship of ships) {
    if (ship.useTemplate && ship.useTemplateLine !== null) {
      try {
        if (!templateTable) {
          const searchDirs = buildSearchPath(fileURLToPath(documentUri));
          templateTable = getEffectiveShipTemplateTable(searchDirs);
        }
        if (!templateTable.has(ship.useTemplate.toLowerCase())) {
          diagnostics.push({
            line: ship.useTemplateLine,
            startCol: 0,
            endCol: 1000,
            message: `+Use Template: "${ship.useTemplate}" was not found in a #Ship Templates section (checked across the active mod's search path)`,
            severity: "warning",
          });
        }
      } catch {
        // Can't resolve a search path for this document (e.g. no mod metadata found) - skip silently.
      }
    }

    if (ship.useShipAsTemplate && ship.useShipAsTemplateLine !== null) {
      try {
        if (!shipTable) {
          const searchDirs = buildSearchPath(fileURLToPath(documentUri));
          shipTable = getEffectiveShipTable(searchDirs);
        }
        if (!shipTable.has(ship.useShipAsTemplate.toLowerCase())) {
          diagnostics.push({
            line: ship.useShipAsTemplateLine,
            startCol: 0,
            endCol: 1000,
            message: `+Use Ship as Template: "${ship.useShipAsTemplate}" was not found as a ships.tbl ship class (checked across the active mod's search path)`,
            severity: "warning",
          });
        }
      } catch {
        // Can't resolve a search path for this document (e.g. no mod metadata found) - skip silently.
      }
    }
  }

  return diagnostics;
}

/**
 * Cross-table check: a ship's `$Default Team:` should name a colors.tbl `$Team Name:`
 * entry, or be the literal `"none"` sentinel (confirmed against ship.cpp: `Team_Colors.
 * find()`, case-insensitive per the engine's own `stricmp()` check).
 */
function computeDefaultTeamDiagnostics(documentUri: string, ships: ShipEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  let colorsTable: Map<string, EffectiveTeamColorEntry> | null = null;

  for (const ship of ships) {
    if (!ship.defaultTeam || ship.defaultTeamLine === null || ship.defaultTeam.toLowerCase() === "none") {
      continue;
    }
    try {
      if (!colorsTable) {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        colorsTable = getEffectiveTeamColorTable(searchDirs);
      }
      if (!colorsTable.has(ship.defaultTeam.toLowerCase())) {
        diagnostics.push({
          line: ship.defaultTeamLine,
          startCol: 0,
          endCol: 1000,
          message: `$Default Team: "${ship.defaultTeam}" was not found in colors.tbl (checked across the active mod's search path)`,
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
 * Cross-table check: every `+Seen By:`/`+When IFF Is:` inside a `$Ship IFF Colors:`/
 * `$Ship IFF Colours:` block should name an iff_defs.tbl `$IFF Name:` entry (confirmed
 * against ship.cpp: both resolved via `iff_lookup()`).
 */
function computeShipIffColorDiagnostics(documentUri: string, ships: ShipEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  let iffTable: Map<string, EffectiveIffEntry> | null = null;

  for (const ship of ships) {
    for (const ref of ship.iffColorRefs) {
      try {
        if (!iffTable) {
          const searchDirs = buildSearchPath(fileURLToPath(documentUri));
          iffTable = getEffectiveIffTable(searchDirs);
        }
        if (!iffTable.has(ref.value.toLowerCase())) {
          diagnostics.push({
            line: ref.line,
            startCol: 0,
            endCol: 1000,
            message: `+${ref.field}: "${ref.value}" was not found in iff_defs.tbl (checked across the active mod's search path)`,
            severity: "warning",
          });
        }
      } catch {
        // Can't resolve a search path for this document (e.g. no mod metadata found) - skip silently.
      }
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
 * Cross-table check: a weapon's OWN `$Armor Type:` (the armor this weapon uses, e.g. for
 * damage it takes from flak/collisions - distinct from `$Damage Type:` above, the damage
 * this weapon inflicts) should name an armor.tbl entry. Mirrors
 * computeArmorTypeDiagnostics() for ships' parallel field.
 */
function computeWeaponArmorTypeDiagnostics(documentUri: string, weapons: WeaponEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  let armorTable: Map<string, EffectiveArmorEntry> | null = null;

  for (const weapon of weapons) {
    if (!weapon.armorType || weapon.armorTypeLine === null) {
      continue;
    }
    try {
      if (!armorTable) {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        armorTable = getEffectiveArmorTable(searchDirs);
      }
      if (!armorTable.has(weapon.armorType.toLowerCase())) {
        diagnostics.push({
          line: weapon.armorTypeLine,
          startCol: 0,
          endCol: 1000,
          message: `$Armor Type: "${weapon.armorType}" was not found in armor.tbl (checked across the active mod's search path)`,
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
 * Cross-table check: every `+Armor Type:` nested inside a `$Conditional Impact:` block
 * should name an armor.tbl entry, or be the literal `"NO ARMOR"` sentinel (confirmed
 * against weapons.cpp, case-insensitive per the engine's own `stricmp()` check).
 */
function computeConditionalImpactArmorDiagnostics(documentUri: string, weapons: WeaponEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  let armorTable: Map<string, EffectiveArmorEntry> | null = null;

  for (const weapon of weapons) {
    for (const ref of weapon.conditionalImpactArmorRefs) {
      if (ref.value.toLowerCase() === "no armor") {
        continue;
      }
      try {
        if (!armorTable) {
          const searchDirs = buildSearchPath(fileURLToPath(documentUri));
          armorTable = getEffectiveArmorTable(searchDirs);
        }
        if (!armorTable.has(ref.value.toLowerCase())) {
          diagnostics.push({
            line: ref.line,
            startCol: 0,
            endCol: 1000,
            message: `+Armor Type: "${ref.value}" (inside $Conditional Impact:) was not found in armor.tbl (checked across the active mod's search path)`,
            severity: "warning",
          });
        }
      } catch {
        // Can't resolve a search path for this document (e.g. no mod metadata found) - skip silently.
      }
    }
  }

  return diagnostics;
}

/** Cross-table check: a weapon's `$Muzzleflash:` should name an mflash.tbl entry. */
function computeMuzzleflashDiagnostics(documentUri: string, weapons: WeaponEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  let mflashTable: Map<string, EffectiveMflashEntry> | null = null;

  for (const weapon of weapons) {
    if (!weapon.muzzleflash || weapon.muzzleflashLine === null) {
      continue;
    }
    try {
      if (!mflashTable) {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        mflashTable = getEffectiveMflashTable(searchDirs);
      }
      if (!mflashTable.has(weapon.muzzleflash.toLowerCase())) {
        diagnostics.push({
          line: weapon.muzzleflashLine,
          startCol: 0,
          endCol: 1000,
          message: `$Muzzleflash: "${weapon.muzzleflash}" was not found in mflash.tbl (checked across the active mod's search path)`,
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
 * Cross-table check: a weapon's `$SSM:` should resolve against ssm.tbl - either as a
 * bare 0-based index, or as a name (see resolveSsmReference()'s doc comment).
 */
function computeSsmDiagnostics(documentUri: string, weapons: WeaponEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  let ssmTable: Map<string, EffectiveSsmEntry> | null = null;

  for (const weapon of weapons) {
    if (!weapon.ssmClass || weapon.ssmClassLine === null) {
      continue;
    }
    try {
      if (!ssmTable) {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        ssmTable = getEffectiveSsmTable(searchDirs);
      }
      if (!resolveSsmReference(ssmTable, weapon.ssmClass)) {
        diagnostics.push({
          line: weapon.ssmClassLine,
          startCol: 0,
          endCol: 1000,
          message: `$SSM: "${weapon.ssmClass}" was not found in ssm.tbl (checked across the active mod's search path)`,
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
 * Cross-table check: every `$substitute:` entry should name a weapons.tbl weapon, or be
 * the literal `"none"` sentinel (confirmed against weapons.cpp - see
 * WeaponSubstituteRef's doc comment).
 */
function computeWeaponSubstituteDiagnostics(documentUri: string, weapons: WeaponEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  let weaponsTable: Map<string, EffectiveWeaponEntry> | null = null;

  for (const weapon of weapons) {
    if (weapon.substituteRefs.length === 0) {
      continue;
    }
    for (const ref of weapon.substituteRefs) {
      if (ref.name.toLowerCase() === "none") {
        continue;
      }
      try {
        if (!weaponsTable) {
          const searchDirs = buildSearchPath(fileURLToPath(documentUri));
          weaponsTable = getEffectiveWeaponsTable(searchDirs);
        }
        if (!weaponsTable.has(ref.name.toLowerCase())) {
          diagnostics.push({
            line: ref.line,
            startCol: 0,
            endCol: 1000,
            message: `$substitute: "${ref.name}" was not found as a weapons.tbl weapon (checked across the active mod's search path)`,
            severity: "warning",
          });
        }
      } catch {
        // Can't resolve a search path for this document (e.g. no mod metadata found) - skip silently.
      }
    }
  }

  return diagnostics;
}

/** Human-readable description of a WeaponNameListRef's target table, for diagnostic/hover messages. */
function describeNameListTarget(kind: WeaponNameListKind): string {
  switch (kind) {
    case "ship-type":
      return "in objecttypes.tbl's #Ship Types section";
    case "ship-class":
      return "as a ships.tbl ship class";
    case "species":
      return "in species_defs.tbl";
    case "iff":
      return "in iff_defs.tbl";
  }
}

/** Whether `name` resolves against the effective table matching a WeaponNameListRef's `kind`. */
function resolveWeaponNameListEntry(searchDirs: string[], kind: WeaponNameListKind, name: string): boolean {
  switch (kind) {
    case "ship-type":
      return getEffectiveObjectTypesTable(searchDirs).has(objectTypesMapKey("ship-types", name));
    case "ship-class":
      return getEffectiveShipTable(searchDirs).has(name.toLowerCase());
    case "species":
      return getEffectiveSpeciesTable(searchDirs).has(name.toLowerCase());
    case "iff":
      return getEffectiveIffTable(searchDirs).has(name.toLowerCase());
  }
}

/**
 * Cross-table check: every name in a weapon's homing-restriction (`+Ship Types:`/
 * `+Ship Classes:`/`+Species:`/`+IFFs:`, nested in `$Homing:`) or proximity-filter
 * (`+Proximity Type:`/`+Proximity Class:`/`+Proximity Species:`/`+Proximity IFF:`, nested
 * in `$Proximity Radius:`/`$MineInfo:`) name-list field should resolve against the
 * appropriate table - see WeaponNameListRef's doc comment for the full field/target
 * mapping.
 */
function computeWeaponNameListDiagnostics(documentUri: string, weapons: WeaponEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  let searchDirs: string[] | null = null;

  for (const weapon of weapons) {
    for (const ref of weapon.nameListRefs) {
      try {
        if (!searchDirs) {
          searchDirs = buildSearchPath(fileURLToPath(documentUri));
        }
        for (const name of ref.names) {
          if (!resolveWeaponNameListEntry(searchDirs, ref.kind, name)) {
            diagnostics.push({
              line: ref.line,
              startCol: 0,
              endCol: 1000,
              message: `+${ref.field}: references "${name}" which was not found ${describeNameListTarget(ref.kind)} (checked across the active mod's search path)`,
              severity: "warning",
            });
          }
        }
      } catch {
        // Can't resolve a search path for this document (e.g. no mod metadata found) - skip silently.
      }
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
 * Cross-table check: every `$Flags:` entry should either be a recognized engine flag
 * (KNOWN_SHIP_FLAGS - ship.cpp's static `Ship_flags[]` plus its handful of typo/
 * deprecation aliases) OR name an objecttypes.tbl `#Ship Types` entry - confirmed against
 * ship.cpp: `parse_ship_values()` checks a `$Flags:` entry against BOTH targets and only
 * warns ("Bogus string in ship flags") when NEITHER matches. Checking only one target (as
 * an earlier version of this diagnostic would have) would false-positive on every
 * legitimate use of the other - see ShipEntryInfo.flags's doc comment.
 */
function computeShipFlagsDiagnostics(documentUri: string, ships: ShipEntryInfo[]): ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  let shipTypeNames: Set<string> | null = null;

  for (const ship of ships) {
    if (ship.flags.length === 0 || ship.flagsLine === null) {
      continue;
    }
    try {
      if (!shipTypeNames) {
        const searchDirs = buildSearchPath(fileURLToPath(documentUri));
        const objectTypesTable = getEffectiveObjectTypesTable(searchDirs);
        shipTypeNames = new Set(objectTypesDisplayNamesForKind(objectTypesTable, "ship-types").map((n) => n.toLowerCase()));
      }
      for (const name of ship.flags) {
        const lower = name.toLowerCase();
        if (!KNOWN_SHIP_FLAGS.has(lower) && !shipTypeNames.has(lower)) {
          diagnostics.push({
            line: ship.flagsLine,
            startCol: 0,
            endCol: 1000,
            message: `$Flags: "${name}" is not a recognized engine flag and was not found in objecttypes.tbl's #Ship Types section (checked across the active mod's search path) - bogus string in ship flags`,
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
    if (isUnsetFileValue(ref.value)) {
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
    if (isUnsetFileValue(ref.value) || ref.value === "-1") {
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
      const submodelItems = pof.subobjects
        .filter((s) => s.name)
        .map((s) => ({
          label: s.name as string,
          kind: CompletionItemKind.Reference,
          detail: `Subsystem in ${current?.modelFile}`,
        }));
      // engine/weapons/communication/sensors/navigation have no submodel of their own -
      // FSO resolves them against an SPCL "special point" instead (see
      // normalizeSpecialPointName's doc comment below).
      const specialPointItems = pof.specialPoints
        .filter((p) => p.name)
        .map((p) => ({
          label: normalizeSpecialPointName(p.name),
          kind: CompletionItemKind.Value,
          detail: `Special point in ${current?.modelFile}`,
        }));
      return [...submodelItems, ...specialPointItems];
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

    if (fieldKey === "pof file" || fieldKey === "model file") {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const names = getSortedPofFileNames(searchDirs);
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
  sharedPrefix = "",
): string {
  if (!bankList) {
    return `${label} banks: (not set)`;
  }
  const declared = bankList.weaponNames.length;
  const status = actualCount === null ? "" : declared === actualCount ? " ✓" : ` ⚠️ (model has ${actualCount})`;
  return `${label} banks: ${declared}${status}${source ? ` — from \`${stripSharedSourcePrefix(source, sharedPrefix)}\`` : ""}`;
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
    (w) =>
      w.nameLine === params.position.line ||
      w.modelFileLine === params.position.line ||
      w.techModelLine === params.position.line ||
      w.externalModelFileLine === params.position.line,
  );
  if (weaponAtLine) {
    try {
      const filePath = fileURLToPath(params.textDocument.uri);
      const searchDirs = buildSearchPath(filePath);
      const effective = getEffectiveWeaponsTable(searchDirs).get(weaponAtLine.name.toLowerCase());
      if (effective) {
        const sharedPrefix = trimSharedSourcePrefix ? computeSharedSourcePrefix(effective.layerSources) : "";

        // Hovering directly over one of the three model-file lines gets a small,
        // single-field hover instead of the full effective-entry dump below - a user
        // checking why their $Tech Model: won't resolve doesn't want to wade through
        // $Model file:/$External Model File:/every other tracked field to find it.
        const modelFieldHover = ((): Hover | null => {
          let label: string;
          let value: string | null;
          let source: string | null;
          let noneMessage: string;
          let pof: PofModel | null;
          if (weaponAtLine.modelFileLine === params.position.line) {
            label = "$Model file:";
            value = effective.modelFile;
            source = effective.modelFileSource;
            noneMessage = "(none - primaries/lasers typically have no model)";
            pof = value && !isUnsetFileValue(value) ? resolvePofForWeaponEntry(params.textDocument.uri, weaponAtLine) : null;
          } else if (weaponAtLine.techModelLine === params.position.line) {
            label = "$Tech Model:";
            value = effective.techModel;
            source = effective.techModelSource;
            noneMessage = "(none - falls back to $Model file: in the tech room)";
            pof = value && !isUnsetFileValue(value) ? resolvePofForWeaponTechModel(params.textDocument.uri, weaponAtLine) : null;
          } else if (weaponAtLine.externalModelFileLine === params.position.line) {
            label = "$External Model File:";
            value = effective.externalModelFile;
            source = effective.externalModelFileSource;
            noneMessage = "(none - falls back to $Model file: in the external/cockpit view)";
            pof = value && !isUnsetFileValue(value) ? resolvePofForWeaponExternalModel(params.textDocument.uri, weaponAtLine) : null;
          } else {
            return null;
          }
          const hasValue = value && !isUnsetFileValue(value);
          const status = !hasValue
            ? noneMessage
            : pof
              ? `\`${value}\` ✓ (${formatPofSummary(pof)})`
              : `\`${value}\` ⚠️ not found along the active mod's search path`;
          return {
            contents: {
              kind: "markdown",
              value:
                `**${label} ${effective.name}**\n\n${status}` +
                (source ? `\n\nFrom: \`${stripSharedSourcePrefix(source, sharedPrefix)}\`` : ""),
            },
          };
        })();
        if (modelFieldHover) {
          return modelFieldHover;
        }

        const layers = effective.layerSources
          .map((s, i) => `${i + 1}. \`${stripSharedSourcePrefix(s, sharedPrefix)}\``)
          .join("\n");
        const hasModelFile = effective.modelFile && !isUnsetFileValue(effective.modelFile);
        const pof = hasModelFile ? resolvePofForWeaponEntry(params.textDocument.uri, weaponAtLine) : null;
        const modelStatus = !hasModelFile
          ? "(none - primaries/lasers typically have no model)"
          : pof
            ? `\`${effective.modelFile}\` ✓ (${formatPofSummary(pof)})`
            : `\`${effective.modelFile}\` ⚠️ not found along the active mod's search path`;
        const hasTechModel = effective.techModel && !isUnsetFileValue(effective.techModel);
        const techPof = hasTechModel ? resolvePofForWeaponTechModel(params.textDocument.uri, weaponAtLine) : null;
        const techModelStatus = !hasTechModel
          ? "(none - falls back to $Model file: in the tech room)"
          : techPof
            ? `\`${effective.techModel}\` ✓ (${formatPofSummary(techPof)})`
            : `\`${effective.techModel}\` ⚠️ not found along the active mod's search path`;
        const hasExternalModelFile = effective.externalModelFile && !isUnsetFileValue(effective.externalModelFile);
        const externalPof = hasExternalModelFile
          ? resolvePofForWeaponExternalModel(params.textDocument.uri, weaponAtLine)
          : null;
        const externalModelStatus = !hasExternalModelFile
          ? "(none - falls back to $Model file: in the external/cockpit view)"
          : externalPof
            ? `\`${effective.externalModelFile}\` ✓ (${formatPofSummary(externalPof)})`
            : `\`${effective.externalModelFile}\` ⚠️ not found along the active mod's search path`;
        const fieldTable = renderEffectiveWeaponFieldTable(effective, sharedPrefix);
        return {
          contents: {
            kind: "markdown",
            value:
              `**$Name: ${effective.name}** (effective, across the active mod's search path)\n\n` +
              `Model File: ${modelStatus}${effective.modelFileSource ? `\n\nFrom: \`${stripSharedSourcePrefix(effective.modelFileSource, sharedPrefix)}\`` : ""}\n\n` +
              `Tech Model: ${techModelStatus}${effective.techModelSource ? `\n\nFrom: \`${stripSharedSourcePrefix(effective.techModelSource, sharedPrefix)}\`` : ""}\n\n` +
              `External Model File: ${externalModelStatus}${effective.externalModelFileSource ? `\n\nFrom: \`${stripSharedSourcePrefix(effective.externalModelFileSource, sharedPrefix)}\`` : ""}\n\n` +
              (sharedPrefix ? `Common path: \`${sharedPrefix}\`\n\n` : "") +
              `Layers applied (base first, later wins):\n${layers}` +
              (fieldTable ? `\n\n---\n\n${fieldTable}` : ""),
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
    if (weapon.armorTypeLine === params.position.line && weapon.armorType) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const entry = getEffectiveArmorTable(searchDirs).get(weapon.armorType.toLowerCase());
        return {
          contents: {
            kind: "markdown",
            value: entry?.nameLocation
              ? `**$Armor Type: ${weapon.armorType}** ✓\n\nDefined at:\n\`${describeResolvedSource(entry.nameLocation.resolved)}:${entry.nameLocation.line + 1}\``
              : `**$Armor Type: ${weapon.armorType}** ⚠️\n\nNot found in armor.tbl along the active mod's search path.`,
          },
        };
      } catch {
        // Fall through to the generic per-line hover below.
      }
    }

    if (weapon.muzzleflashLine === params.position.line && weapon.muzzleflash) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const entry = getEffectiveMflashTable(searchDirs).get(weapon.muzzleflash.toLowerCase());
        return {
          contents: {
            kind: "markdown",
            value: entry?.nameLocation
              ? `**$Muzzleflash: ${weapon.muzzleflash}** ✓\n\nDefined at:\n\`${describeResolvedSource(entry.nameLocation.resolved)}:${entry.nameLocation.line + 1}\``
              : `**$Muzzleflash: ${weapon.muzzleflash}** ⚠️\n\nNot found in mflash.tbl along the active mod's search path.`,
          },
        };
      } catch {
        // Fall through to the generic per-line hover below.
      }
    }

    if (weapon.ssmClassLine === params.position.line && weapon.ssmClass) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const ssmTable = getEffectiveSsmTable(searchDirs);
        const entry = resolveSsmReference(ssmTable, weapon.ssmClass);
        return {
          contents: {
            kind: "markdown",
            value: entry?.nameLocation
              ? `**$SSM: ${weapon.ssmClass}** ✓ (${entry.name})\n\nDefined at:\n\`${describeResolvedSource(entry.nameLocation.resolved)}:${entry.nameLocation.line + 1}\``
              : `**$SSM: ${weapon.ssmClass}** ⚠️\n\nNot found in ssm.tbl along the active mod's search path.`,
          },
        };
      } catch {
        // Fall through to the generic per-line hover below.
      }
    }

    const substituteRef = weapon.substituteRefs.find((r) => r.line === params.position.line);
    if (substituteRef) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const isNone = substituteRef.name.toLowerCase() === "none";
        const entry = isNone ? null : getEffectiveWeaponsTable(searchDirs).get(substituteRef.name.toLowerCase());
        return {
          contents: {
            kind: "markdown",
            value: isNone
              ? `**$substitute: none**\n\nNo substitution for this slot.`
              : entry?.nameLocation
                ? `**$substitute: ${substituteRef.name}** ✓\n\nDefined at:\n\`${describeResolvedSource(entry.nameLocation.resolved)}:${entry.nameLocation.line + 1}\``
                : `**$substitute: ${substituteRef.name}** ⚠️\n\nNot found as a weapons.tbl weapon along the active mod's search path.`,
          },
        };
      } catch {
        // Fall through to the generic per-line hover below.
      }
    }

    const conditionalImpactArmorRef = weapon.conditionalImpactArmorRefs.find((r) => r.line === params.position.line);
    if (conditionalImpactArmorRef) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const isNoArmor = conditionalImpactArmorRef.value.toLowerCase() === "no armor";
        const entry = isNoArmor ? null : getEffectiveArmorTable(searchDirs).get(conditionalImpactArmorRef.value.toLowerCase());
        return {
          contents: {
            kind: "markdown",
            value: isNoArmor
              ? `**+Armor Type: NO ARMOR** (inside $Conditional Impact:)\n\nMatches a target with no armor type set.`
              : entry?.nameLocation
                ? `**+Armor Type: ${conditionalImpactArmorRef.value}** ✓ (inside $Conditional Impact:)\n\nDefined at:\n\`${describeResolvedSource(entry.nameLocation.resolved)}:${entry.nameLocation.line + 1}\``
                : `**+Armor Type: ${conditionalImpactArmorRef.value}** ⚠️ (inside $Conditional Impact:)\n\nNot found in armor.tbl along the active mod's search path.`,
          },
        };
      } catch {
        // Fall through to the generic per-line hover below.
      }
    }

    const nameListRef = weapon.nameListRefs.find((r) => r.line === params.position.line);
    if (nameListRef) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const items = nameListRef.names
          .map((n) => `\`${n}\`${resolveWeaponNameListEntry(searchDirs, nameListRef.kind, n) ? " ✓" : " ⚠️"}`)
          .join(", ");
        return {
          contents: {
            kind: "markdown",
            value: `**+${nameListRef.field}:**\n\n${items}\n\n(checked ${describeNameListTarget(nameListRef.kind)}, across the active mod's search path)`,
          },
        };
      } catch {
        // Fall through to the generic per-line hover below.
      }
    }

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

  // Hovering directly over $Cockpit POF file:/$POF file Techroom:/$POF target file:/
  // +Generic Debris POF file: gets a small, single-field hover instead of the full
  // effective-entry dump below - same rationale as the weapon model-field hover above.
  const shipAtModelFieldLine = ships.find(
    (s) =>
      s.cockpitModelFileLine === params.position.line ||
      s.techModelLine === params.position.line ||
      s.hudTargetModelFileLine === params.position.line ||
      s.genericDebrisModelFileLine === params.position.line,
  );
  if (shipAtModelFieldLine) {
    try {
      const filePath = fileURLToPath(params.textDocument.uri);
      const searchDirs = buildSearchPath(filePath);
      const effective = getEffectiveShipTable(searchDirs).get(shipAtModelFieldLine.name.toLowerCase());
      if (effective) {
        const sharedPrefix = trimSharedSourcePrefix ? computeSharedSourcePrefix(effective.layerSources) : "";
        let label: string;
        let value: string | null;
        let source: string | null;
        let pof: PofModel | null;
        if (shipAtModelFieldLine.cockpitModelFileLine === params.position.line) {
          label = "$Cockpit POF file:";
          value = effective.cockpitModelFile;
          source = effective.cockpitModelFileSource;
          pof =
            value && !isUnsetFileValue(value) ? resolvePofForShipCockpitModel(params.textDocument.uri, shipAtModelFieldLine) : null;
        } else if (shipAtModelFieldLine.techModelLine === params.position.line) {
          label = "$POF file Techroom:";
          value = effective.techModel;
          source = effective.techModelSource;
          pof = value && !isUnsetFileValue(value) ? resolvePofForShipTechModel(params.textDocument.uri, shipAtModelFieldLine) : null;
        } else if (shipAtModelFieldLine.hudTargetModelFileLine === params.position.line) {
          label = "$POF target file:";
          value = effective.hudTargetModelFile;
          source = effective.hudTargetModelFileSource;
          pof =
            value && !isUnsetFileValue(value)
              ? resolvePofForShipHudTargetModel(params.textDocument.uri, shipAtModelFieldLine)
              : null;
        } else {
          label = "+Generic Debris POF file:";
          value = effective.genericDebrisModelFile;
          source = effective.genericDebrisModelFileSource;
          pof =
            value && !isUnsetFileValue(value)
              ? resolvePofForShipGenericDebrisModel(params.textDocument.uri, shipAtModelFieldLine)
              : null;
        }
        const hasValue = value && !isUnsetFileValue(value);
        const status = !hasValue
          ? "(none)"
          : pof
            ? `\`${value}\` ✓ (${formatPofSummary(pof)})`
            : `\`${value}\` ⚠️ not found along the active mod's search path`;
        return {
          contents: {
            kind: "markdown",
            value:
              `**${label} ${effective.name}**\n\n${status}` +
              (source ? `\n\nFrom: \`${stripSharedSourcePrefix(source, sharedPrefix)}\`` : ""),
          },
        };
      }
    } catch {
      // Fall through to the generic per-line hover below.
    }
  }

  const shipAtNameLine = ships.find((s) => s.nameLine === params.position.line);
  if (shipAtNameLine) {
    try {
      const filePath = fileURLToPath(params.textDocument.uri);
      const searchDirs = buildSearchPath(filePath);
      const effective = getEffectiveShipTable(searchDirs).get(shipAtNameLine.name.toLowerCase());
      if (effective) {
        const sharedPrefix = trimSharedSourcePrefix ? computeSharedSourcePrefix(effective.layerSources) : "";
        const layers = effective.layerSources
          .map((s, i) => `${i + 1}. \`${stripSharedSourcePrefix(s, sharedPrefix)}\``)
          .join("\n");
        const hasModelFile = effective.modelFile && !isUnsetFileValue(effective.modelFile);
        const pof = hasModelFile ? resolvePofForShipEntry(params.textDocument.uri, shipAtNameLine) : null;
        const fieldTable = renderEffectiveShipFieldTable(effective, sharedPrefix);
        return {
          contents: {
            kind: "markdown",
            value:
              `**$Name: ${effective.name}** (effective, across the active mod's search path)\n\n` +
              `POF file: \`${hasModelFile ? effective.modelFile : "(none)"}\`${effective.modelFileSource ? ` — from \`${stripSharedSourcePrefix(effective.modelFileSource, sharedPrefix)}\`` : ""}\n\n` +
              `Subsystems: ${effective.subsystems.length}${effective.subsystemsSource ? ` — from \`${stripSharedSourcePrefix(effective.subsystemsSource, sharedPrefix)}\`` : ""}\n\n` +
              `Armor Type: ${effective.armorType ?? "(none)"}${effective.armorTypeSource ? ` — from \`${stripSharedSourcePrefix(effective.armorTypeSource, sharedPrefix)}\`` : ""}\n\n` +
              `${formatBankLine("Primary", effective.defaultPrimaryBanks, effective.defaultPrimaryBanksSource, pof?.primaryBankCount ?? null, sharedPrefix)}\n\n` +
              `${formatBankLine("Secondary", effective.defaultSecondaryBanks, effective.defaultSecondaryBanksSource, pof?.secondaryBankCount ?? null, sharedPrefix)}\n\n` +
              (sharedPrefix ? `Common path: \`${sharedPrefix}\`\n\n` : "") +
              `Layers applied (base first, later wins):\n${layers}` +
              (fieldTable ? `\n\n---\n\n${fieldTable}` : ""),
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

    if (ship.countermeasureTypeLine === params.position.line && ship.countermeasureType) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const entry = getEffectiveWeaponsTable(searchDirs).get(ship.countermeasureType.toLowerCase());
        return {
          contents: {
            kind: "markdown",
            value: entry?.nameLocation
              ? `**$Countermeasure type: ${ship.countermeasureType}** ✓\n\nDefined at:\n\`${describeResolvedSource(entry.nameLocation.resolved)}:${entry.nameLocation.line + 1}\``
              : `**$Countermeasure type: ${ship.countermeasureType}** ⚠️\n\nNot found as a weapons.tbl weapon along the active mod's search path.`,
          },
        };
      } catch {
        // Fall through to the generic per-line hover below.
      }
    }

    if (ship.defaultTeamLine === params.position.line && ship.defaultTeam) {
      const isNone = ship.defaultTeam.toLowerCase() === "none";
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const entry = isNone ? null : getEffectiveTeamColorTable(searchDirs).get(ship.defaultTeam.toLowerCase());
        return {
          contents: {
            kind: "markdown",
            value: isNone
              ? `**$Default Team: none**\n\nNo team colors.`
              : entry?.nameLocation
                ? `**$Default Team: ${ship.defaultTeam}** ✓\n\nDefined at:\n\`${describeResolvedSource(entry.nameLocation.resolved)}:${entry.nameLocation.line + 1}\``
                : `**$Default Team: ${ship.defaultTeam}** ⚠️\n\nNot found in colors.tbl along the active mod's search path.`,
          },
        };
      } catch {
        // Fall through to the generic per-line hover below.
      }
    }

    if (ship.useTemplateLine === params.position.line && ship.useTemplate) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const entry = getEffectiveShipTemplateTable(searchDirs).get(ship.useTemplate.toLowerCase());
        return {
          contents: {
            kind: "markdown",
            value: entry?.nameLocation
              ? `**+Use Template: ${ship.useTemplate}** ✓\n\nDefined at:\n\`${describeResolvedSource(entry.nameLocation.resolved)}:${entry.nameLocation.line + 1}\``
              : `**+Use Template: ${ship.useTemplate}** ⚠️\n\nNot found in a #Ship Templates section along the active mod's search path.`,
          },
        };
      } catch {
        // Fall through to the generic per-line hover below.
      }
    }

    if (ship.useShipAsTemplateLine === params.position.line && ship.useShipAsTemplate) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const entry = getEffectiveShipTable(searchDirs).get(ship.useShipAsTemplate.toLowerCase());
        return {
          contents: {
            kind: "markdown",
            value: entry?.nameLocation
              ? `**+Use Ship as Template: ${ship.useShipAsTemplate}** ✓\n\nDefined at:\n\`${describeResolvedSource(entry.nameLocation.resolved)}:${entry.nameLocation.line + 1}\``
              : `**+Use Ship as Template: ${ship.useShipAsTemplate}** ⚠️\n\nNot found as a ships.tbl ship class along the active mod's search path.`,
          },
        };
      } catch {
        // Fall through to the generic per-line hover below.
      }
    }

    const iffColorRef = ship.iffColorRefs.find((r) => r.line === params.position.line);
    if (iffColorRef) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const entry = getEffectiveIffTable(searchDirs).get(iffColorRef.value.toLowerCase());
        return {
          contents: {
            kind: "markdown",
            value: entry?.nameLocation
              ? `**+${iffColorRef.field}: ${iffColorRef.value}** ✓ (inside $Ship IFF Colors:)\n\nDefined at:\n\`${describeResolvedSource(entry.nameLocation.resolved)}:${entry.nameLocation.line + 1}\``
              : `**+${iffColorRef.field}: ${iffColorRef.value}** ⚠️ (inside $Ship IFF Colors:)\n\nNot found in iff_defs.tbl along the active mod's search path.`,
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

    if (ship.flagsLine === params.position.line && ship.flags.length > 0) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const objectTypesTable = getEffectiveObjectTypesTable(searchDirs);
        const shipTypeNames = new Set(objectTypesDisplayNamesForKind(objectTypesTable, "ship-types").map((n) => n.toLowerCase()));
        const items = ship.flags
          .map((n) => {
            const lower = n.toLowerCase();
            if (KNOWN_SHIP_FLAGS.has(lower)) {
              return `\`${n}\` ✓ (engine flag)`;
            }
            if (shipTypeNames.has(lower)) {
              return `\`${n}\` ✓ (ship type)`;
            }
            return `\`${n}\` ⚠️`;
          })
          .join(", ");
        return {
          contents: {
            kind: "markdown",
            value: `**$Flags:**\n\n${items}\n\n(checked against the engine's recognized flags and objecttypes.tbl's #Ship Types section along the active mod's search path)`,
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

    // engine/weapons/communication/sensors/navigation subsystems are non-geometric -
    // FSO resolves them against an SPCL "special point" (name conventionally stored
    // with a leading "$", e.g. "$engine") instead of a SOBJ/OBJ2 submodel.
    const specialPointMatch = pof.specialPoints.find((p) => normalizeSpecialPointName(p.name) === subsystem.name.trim().toLowerCase());
    if (specialPointMatch) {
      return {
        contents: {
          kind: "markdown",
          value: `**$Subsystem: ${subsystem.name}** ✓\n\nFound in \`${ship.modelFile}\` as a special point (radius ${specialPointMatch.radius.toFixed(2)}) - normal for a non-geometric subsystem like engine/weapons/sensors/navigation/communication, which has no submodel of its own.`,
        },
      };
    }

    const knownNames = pof.subobjects
      .map((s) => s.name)
      .filter((n): n is string => !!n)
      .slice(0, 20);
    const knownSpecialPointNames = pof.specialPoints.map((p) => p.name).filter((n): n is string => !!n);
    return {
      contents: {
        kind: "markdown",
        value:
          `**$Subsystem: ${subsystem.name}** ⚠️\n\nNo matching submodel or special point found in \`${ship.modelFile}\`.\n\n` +
          `Available submodel names: ${knownNames.length ? knownNames.map((n) => `\`${n}\``).join(", ") : "(none decoded)"}` +
          (knownSpecialPointNames.length ? `\n\nAvailable special points: ${knownSpecialPointNames.map((n) => `\`${n}\``).join(", ")}` : ""),
      },
    };
  }

  const mission = missionEntriesByUri.get(params.textDocument.uri);
  if (mission) {
    const shipClass = mission.shipClassRefs.find((r) => r.line === params.position.line);
    if (shipClass) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const entry = getEffectiveShipTable(searchDirs).get(shipClass.value.toLowerCase());
        return {
          contents: {
            kind: "markdown",
            value: entry?.nameLocation
              ? `**$Class: ${shipClass.value}** ✓\n\nDefined at:\n\`${describeResolvedSource(entry.nameLocation.resolved)}:${entry.nameLocation.line + 1}\``
              : `**$Class: ${shipClass.value}** ⚠️\n\nNot found in ships.tbl along the active mod's search path.`,
          },
        };
      } catch {
        // Fall through to the generic per-line hover below.
      }
    }

    const missionToken = findMissionRefTokenAt(mission, hoverDoc, params.position.line, params.position.character);
    if (missionToken) {
      try {
        const searchDirs = buildSearchPath(fileURLToPath(params.textDocument.uri));
        const entry =
          missionToken.kind === "ship"
            ? getEffectiveShipTable(searchDirs).get(missionToken.name.toLowerCase())
            : getEffectiveWeaponsTable(searchDirs).get(missionToken.name.toLowerCase());
        const tableName = missionToken.kind === "ship" ? "ships.tbl" : "weapons.tbl";
        return {
          contents: {
            kind: "markdown",
            value: entry?.nameLocation
              ? `**${missionToken.name}** ✓\n\nDefined at:\n\`${describeResolvedSource(entry.nameLocation.resolved)}:${entry.nameLocation.line + 1}\``
              : `**${missionToken.name}** ⚠️\n\nNot found in ${tableName} along the active mod's search path.`,
          },
        };
      } catch {
        // Fall through to the generic per-line hover below.
      }
    }
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

/**
 * A model-space marker with no polygon geometry of its own (POF SPCL chunk - e.g.
 * $Engine/$Weapons/$Communication/$Sensors/$Navigation). Rendered client-side as a
 * translucent sphere at `position` sized to `radius`, the same "lollipop" treatment
 * pof-tools (github.com/Baezon/pof-tools, src/main.rs) uses for every point-type POF
 * entity - confirmed there as a plain sphere with no direction glyph, unlike docking
 * bays which additionally draw an arrow/cone along their normal.
 */
interface SpecialPointPayload {
  name: string;
  position: [number, number, number];
  radius: number;
}

interface PofGeometryForSubsystemResult {
  modelFile: string;
  /** Index into `submodels` matching the requested `$Subsystem:` name (case-insensitive), or -1 if no submodel name matched. */
  targetSubmodelIndex: number;
  submodels: SubmodelGeometryPayload[];
  /** Number of detail (LOD) levels this model declares - lets the client decide whether to show a detail-level picker at all. */
  detailLevelCount: number;
  specialPoints: SpecialPointPayload[];
  /** Index into `specialPoints` matching the requested `$Subsystem:` name (see normalizeSpecialPointName), or -1 if none matched. Mutually exclusive with `targetSubmodelIndex` - a subsystem is either a submodel or a special point, never both. */
  targetSpecialPointIndex: number;
}

/**
 * A ships.tbl $Subsystem: name for a non-geometric subsystem (engine/weapons/
 * communication/sensors/navigation) has no matching SOBJ/OBJ2 submodel - FSO instead
 * resolves it against an SPCL "special point", whose name is conventionally stored
 * with a leading "$" (e.g. "$engine"). Strips that so "engine" (the subsystem name)
 * compares equal to "$engine" (the special point name).
 */
function normalizeSpecialPointName(name: string | null): string {
  return (name ?? "").replace(/^\$/, "").trim().toLowerCase();
}

/** Builds the full per-submodel geometry payload for `pof`, highlighting whichever submodel (or, failing that, special point) name matches `targetSubmodelName` (case-insensitive). Shared by both request handlers below - one keyed off a table document + line, the other off a raw POF file path. */
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

  const specialPoints: SpecialPointPayload[] = pof.specialPoints.map((p, i) => ({
    name: p.name ?? `special_${i}`,
    position: [p.position.x, p.position.y, p.position.z],
    radius: p.radius,
  }));

  const targetSpecialPointIndex =
    targetSubmodelName && targetSubmodelIndex === -1
      ? pof.specialPoints.findIndex((p) => normalizeSpecialPointName(p.name) === targetSubmodelName.trim().toLowerCase())
      : -1;

  return {
    modelFile: modelFileLabel,
    targetSubmodelIndex,
    submodels,
    detailLevelCount: pof.detailLevelRootSubmodels.length,
    specialPoints,
    targetSpecialPointIndex,
  };
}

/**
 * Looks up `map` by `uri`, tolerant of a confirmed `vscode.Uri.toString()` quirk on
 * Windows: the SAME open document's uri serializes with an unencoded drive-letter
 * colon ("file:///e:/...") when this extension's own code calls `.toString()` on it
 * (e.g. inside a hover provider, building a command-link argument), but with it
 * percent-encoded ("file:///e%3A/...") when vscode-languageclient's own internal
 * document-sync feature calls the exact same method while sending `textDocument/
 * didOpen` - and `vscode-languageserver`'s `TextDocuments` class keys its map by the
 * raw wire string with no normalization of its own, so those two encodings of the
 * identical file never compare equal. Every standard LSP request (hover, completion,
 * diagnostics, go-to-definition) is built entirely by vscode-languageclient itself and
 * so is internally consistent; this bites only a hand-built document-uri argument to a
 * custom request - the one below is the only place in this codebase that does that.
 * Falls back to a full, uri-decoded-and-lowercased scan only when the direct key
 * lookup misses, so the common case (already-matching keys) stays a plain Map.get().
 */
function getByUri<T>(map: Map<string, T>, uri: string): T | undefined {
  const direct = map.get(uri);
  if (direct !== undefined) {
    return direct;
  }
  let normalizedTarget: string;
  try {
    normalizedTarget = decodeURIComponent(uri).toLowerCase();
  } catch {
    return undefined;
  }
  for (const [key, value] of map) {
    try {
      if (decodeURIComponent(key).toLowerCase() === normalizedTarget) {
        return value;
      }
    } catch {
      // A key that fails to percent-decode can't match a well-formed uri either way.
    }
  }
  return undefined;
}

/**
 * Given a document URI + line, finds the ship `$Subsystem:` entry at that exact line
 * (mirrors the subsystem-hover lookup above), resolves and decodes its POF's full
 * geometry, and returns everything the client's 3D viewer webview needs to render
 * every submodel and highlight the one matching this subsystem. Also matches a ship's
 * `$POF file:`/`$Cockpit POF file:`/`$POF file Techroom:`/`$POF target file:`/
 * `+Generic Debris POF file:` line and a weapon's `$Model file:`/`$Tech Model:`/
 * `$External Model File:` line, all opening the model with nothing highlighted (neither
 * table has a `$Subsystem:` equivalent for these). Returns a `{ error }` object instead
 * of a result for any line that isn't one of these, or
 * whose model can't be resolved - distinguished by reason (rather than a bare `null`,
 * as an earlier version returned for both) specifically so a failure reported against
 * real-world data can be diagnosed remotely instead of just "nothing happened, no
 * information why". F12's own call site (unlike the hover-link command) ignores the
 * `error` field and falls through to normal go-to-definition either way.
 */
connection.onRequest(
  "fso-lsp/getPofGeometryForSubsystem",
  (params: { uri: string; line: number }): PofGeometryForSubsystemResult | { error: string } => {
    const ships = getByUri(shipEntriesByUri, params.uri) ?? [];

    for (const ship of ships) {
      // `$POF file:` itself has no single submodel to highlight - buildPofGeometryResult
      // treats a null target name as "none", same as a `$Subsystem:` name with no
      // matching submodel, so the viewer just opens showing the whole model.
      const isModelFileLine = ship.modelFileLine === params.line;
      const subsystem = ship.subsystems.find((s) => s.line === params.line);
      if (isModelFileLine || subsystem) {
        // resolvePofForShipEntry() itself already falls back to the mod's merged/effective
        // $POF file: (a .tbm override block for this ship may not repeat that field at
        // all), so don't gate on ship.modelFile - this document's own locally-parsed
        // value - before even trying; only use it as a display label, with a generic
        // fallback when this block doesn't set it locally.
        const pof = resolvePofForShipEntry(params.uri, ship);
        if (!pof) {
          return {
            error: `Couldn't resolve model "${ship.modelFile ?? "(not set in this document - check a merged .tbm layer)"}" for ship "${ship.name}" along the mod's search path.`,
          };
        }

        return buildPofGeometryResult(pof, ship.modelFile ?? "(unknown model file)", subsystem ? subsystem.name : null);
      }

      // The remaining ship model fields (cockpit/tech/HUD-target/generic-debris) have no
      // $Subsystem: equivalent either, same "null target name" treatment as a weapon's
      // model fields below.
      const shipModelFields: {
        line: number | null;
        label: string;
        value: string | null;
        resolve: () => PofModel | null;
      }[] = [
        {
          line: ship.cockpitModelFileLine,
          label: "$Cockpit POF file:",
          value: ship.cockpitModelFile,
          resolve: () => resolvePofForShipCockpitModel(params.uri, ship),
        },
        {
          line: ship.techModelLine,
          label: "$POF file Techroom:",
          value: ship.techModel,
          resolve: () => resolvePofForShipTechModel(params.uri, ship),
        },
        {
          line: ship.hudTargetModelFileLine,
          label: "$POF target file:",
          value: ship.hudTargetModelFile,
          resolve: () => resolvePofForShipHudTargetModel(params.uri, ship),
        },
        {
          line: ship.genericDebrisModelFileLine,
          label: "+Generic Debris POF file:",
          value: ship.genericDebrisModelFile,
          resolve: () => resolvePofForShipGenericDebrisModel(params.uri, ship),
        },
      ];
      const matchedShipField = shipModelFields.find((f) => f.line === params.line);
      if (!matchedShipField) {
        continue;
      }

      const shipFieldPof = matchedShipField.resolve();
      if (!shipFieldPof) {
        return {
          error: `Couldn't resolve model "${matchedShipField.value ?? "(not set in this document - check a merged .tbm layer)"}" for ship "${ship.name}"'s ${matchedShipField.label} along the mod's search path.`,
        };
      }

      return buildPofGeometryResult(shipFieldPof, matchedShipField.value ?? "(unknown model file)", null);
    }

    // Weapons have no `$Subsystem:` concept, so `$Model file:`/`$Tech Model:`/
    // `$External Model File:` just open the whole model with nothing highlighted - same
    // "null target name" treatment as a ship's bare `$POF file:` line above.
    const weapons = getByUri(weaponEntriesByUri, params.uri) ?? [];
    for (const weapon of weapons) {
      const weaponModelFields: {
        line: number | null;
        label: string;
        value: string | null;
        resolve: () => PofModel | null;
      }[] = [
        { line: weapon.modelFileLine, label: "$Model file:", value: weapon.modelFile, resolve: () => resolvePofForWeaponEntry(params.uri, weapon) },
        { line: weapon.techModelLine, label: "$Tech Model:", value: weapon.techModel, resolve: () => resolvePofForWeaponTechModel(params.uri, weapon) },
        {
          line: weapon.externalModelFileLine,
          label: "$External Model File:",
          value: weapon.externalModelFile,
          resolve: () => resolvePofForWeaponExternalModel(params.uri, weapon),
        },
      ];
      const matched = weaponModelFields.find((f) => f.line === params.line);
      if (!matched) {
        continue;
      }

      const pof = matched.resolve();
      if (!pof) {
        return {
          error: `Couldn't resolve model "${matched.value ?? "(not set in this document - check a merged .tbm layer)"}" for weapon "${weapon.name}"'s ${matched.label} along the mod's search path.`,
        };
      }

      return buildPofGeometryResult(pof, matched.value ?? "(unknown model file)", null);
    }

    return {
      error: `Line ${params.line + 1} isn't a $Subsystem:, $POF file:, $Cockpit POF file:, $POF file Techroom:, $POF target file:, +Generic Debris POF file:, $Model file:, $Tech Model:, or $External Model File: entry in this document.`,
    };
  },
);

documents.listen(connection);
connection.listen();
