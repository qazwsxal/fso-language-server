import * as path from "path";
import {
  commands,
  ExtensionContext,
  window,
  workspace,
  languages,
  Uri,
  TextDocumentContentProvider,
  Hover,
  HoverProvider,
  MarkdownString,
} from "vscode";
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";
import { showPofViewer, PofGeometryForSubsystemResult } from "./pofViewer";

let client: LanguageClient;

/**
 * Must match VP_CONTENT_SCHEME in server/src/server.ts - the client and server are
 * separate esbuild bundles with no shared module, so this is a manually-kept-in-sync
 * literal rather than an import.
 */
const VP_CONTENT_SCHEME = "fso-tbl-vp";

/** Scheme for the synthesized "effective definition" virtual document - see effectiveContentProvider below. */
const EFFECTIVE_CONTENT_SCHEME = "fso-tbl-effective";

/** A ships.tbl/-shp.tbm or weapons.tbl/-wep.tbm loose or virtual path - the two table kinds effectiveEntryFormatter.ts (server-side) knows how to render. */
const SHIP_OR_WEAPON_TABLE_PATTERN = /(^|[\\/])(ships|weapons)\.tbl$|-(shp|wep)\.tbm$/i;

/**
 * Builds the virtual document URI for `fsoLsp.openEffectiveDefinition`. The query string
 * carries everything `provideTextDocumentContent` needs to re-fetch fresh content (the
 * source document's URI + the `$Name:` line), mirroring `fso-tbl-vp:`'s `vp`/entry-path
 * query convention. The path is a synthetic filename ending in `.tbl` purely so VSCode's
 * extension-based language association (this package's own `languages[0].extensions`)
 * picks up fso-table syntax highlighting for the opened document, same trick `fso-tbl-vp:`
 * gets for free from its entries' real filenames.
 */
function buildEffectiveDefinitionUri(sourceUriString: string, line: number, displayName: string): Uri {
  const safeName = displayName.replace(/[\\/:*?"<>|]/g, "_");
  const query = new URLSearchParams({ uri: sourceUriString, line: String(line) }).toString();
  return Uri.from({ scheme: EFFECTIVE_CONTENT_SCHEME, path: `/${safeName} (effective).tbl`, query });
}

export function activate(context: ExtensionContext): void {
  // build.js (esbuild) bundles server/src/server.ts to dist/server.js alongside this
  // extension's own dist/extension.js, so the shipped .vsix is self-contained and
  // doesn't reach into the sibling `server` workspace package at runtime.
  const serverModule = context.asAbsolutePath(path.join("dist", "server.js"));

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "fso-table" }],
    synchronize: {
      // Beyond the open document itself, the server's merged-table/POF/texture caches
      // depend on sibling .tbl/.tbm layers, mod.json (Knossos - the primary source of
      // truth) / mod.ini (fallback) search-path changes, referenced .pof models,
      // .vp/.vpc archives, and texture/animation files - watch all of them so the
      // server can invalidate on change.
      fileEvents: [
        workspace.createFileSystemWatcher("**/*.{tbl,tbm}"),
        workspace.createFileSystemWatcher("**/*.pof"),
        workspace.createFileSystemWatcher("**/*.{vp,vpc}"),
        workspace.createFileSystemWatcher("**/mod.json"),
        workspace.createFileSystemWatcher("**/mod.ini"),
        workspace.createFileSystemWatcher("**/*.{dds,tga,pcx,png,jpg,jpeg,ani,eff}"),
      ],
    },
  };

  client = new LanguageClient("fsoLsp", "FSO Table Language Server", serverOptions, clientOptions);
  const clientReady = client.start(); // vscode-languageclient v9: start() itself resolves once initialized (no separate onReady()).

  /**
   * Go-to-definition/declaration targets that live inside a VP/VPC archive (rather than
   * as a loose file) have no real filesystem path - the server encodes them as a
   * `fso-tbl-vp:` URI instead (path = entry path within the archive, query's `vp` =
   * the archive's absolute path) and this provider fetches the decoded text on demand
   * via a custom request, since all VP-reading logic lives server-side only (no
   * duplicated archive-parsing code here). VSCode treats a content-provider-backed
   * document as read-only by construction (there's no file to save back to), which is
   * exactly the "readonly copy" behavior wanted for a definition target outside the
   * current workspace/mod.
   */
  const vpContentProvider: TextDocumentContentProvider = {
    async provideTextDocumentContent(uri: Uri): Promise<string> {
      const vpPath = new URLSearchParams(uri.query).get("vp");
      const entryPath = uri.path.replace(/^\//, "");
      if (!vpPath) {
        return "; missing 'vp' query parameter on fso-tbl-vp: URI";
      }
      try {
        await clientReady;
        return await client.sendRequest<string>("fso-lsp/readVpEntryText", { vpPath, entryPath });
      } catch (err) {
        return `; failed to read "${entryPath}" from "${vpPath}": ${err}`;
      }
    },
  };
  context.subscriptions.push(workspace.registerTextDocumentContentProvider(VP_CONTENT_SCHEME, vpContentProvider));

  /**
   * Backs `fso-tbl-effective:` documents opened by `fsoLsp.openEffectiveDefinition` - the
   * "Show effective definition" hover link below. Re-fetches fresh content on every call
   * (rather than the command pre-fetching once) so the document reflects the latest merge
   * if it's reopened later, same as `vpContentProvider` above.
   */
  const effectiveContentProvider: TextDocumentContentProvider = {
    async provideTextDocumentContent(uri: Uri): Promise<string> {
      const params = new URLSearchParams(uri.query);
      const sourceUri = params.get("uri");
      const lineParam = params.get("line");
      if (!sourceUri || lineParam === null) {
        return ";; missing 'uri'/'line' query parameters on fso-tbl-effective: URI";
      }
      try {
        await clientReady;
        return await client.sendRequest<string>("fso-lsp/getEffectiveEntryText", { uri: sourceUri, line: Number(lineParam) });
      } catch (err) {
        return `;; failed to build effective definition: ${err}`;
      }
    },
  };
  context.subscriptions.push(workspace.registerTextDocumentContentProvider(EFFECTIVE_CONTENT_SCHEME, effectiveContentProvider));

  /**
   * Opens the 3D POF viewer for the `$Subsystem:` entry at `line` in the given document,
   * if there is one. Returns true if it did (caller should stop there instead of falling
   * through to normal go-to-definition).
   */
  async function openPofViewerAt(uriString: string, line: number): Promise<boolean> {
    try {
      await clientReady;
      const result = await client.sendRequest<PofGeometryForSubsystemResult | null>(
        "fso-lsp/getPofGeometryForSubsystem",
        { uri: uriString, line },
      );
      if (result) {
        showPofViewer(context, result);
        return true;
      }
    } catch {
      // Fall through to normal go-to-definition.
    }
    return false;
  }

  /**
   * F12 on a ship's `$Subsystem:` line opens an explorable 3D view of that ship's POF
   * model instead of navigating to a text location. This is deliberately NOT
   * implemented as a `languages.registerDefinitionProvider` (as an earlier version of
   * this feature was) - VSCode calls a registered DefinitionProvider on every ctrl+hover
   * mouse move to decide whether to show the "click here to go to definition" underline,
   * not just on an actual click/F12 (this is a documented, currently-unchangeable
   * VSCode behavior - see microsoft/vscode#212444). A provider that performs a real side
   * effect (opening/revealing a webview) reacts to that hover-preview call exactly the
   * same as a real invocation, so merely resting the mouse over a subsystem line while
   * holding Ctrl silently popped the viewer open every time.
   *
   * A command bound directly to the F12 key (see package.json's `keybindings`, scoped to
   * `editorLangId == fso-table`) only ever fires on an actual keypress, so it can safely
   * perform the side effect. Every other cross-reference (armor type, species, weapon
   * names, ...) is unaffected: those are pure navigation with no side effect, so the
   * server's own onDefinition/onDeclaration already handles them correctly for both F12
   * and ctrl+click via the normal LSP path.
   */
  context.subscriptions.push(
    commands.registerCommand("fsoLsp.revealDefinitionOrPofViewer", async () => {
      const editor = window.activeTextEditor;
      if (editor && editor.document.languageId === "fso-table") {
        if (await openPofViewerAt(editor.document.uri.toString(), editor.selection.active.line)) {
          return;
        }
      }
      await commands.executeCommand("editor.action.revealDefinition");
    }),
  );

  /** Invoked only by the hover link below - see its doc comment for why this is a separate, explicit-args command rather than reading the active editor's cursor position. */
  context.subscriptions.push(
    commands.registerCommand("fsoLsp.openPofViewerAtPosition", (uriString: string, line: number) => {
      void openPofViewerAt(uriString, line);
    }),
  );

  /**
   * The mouse-driven equivalent of F12 for `$Subsystem:` lines: hovering offers a
   * clickable "Open 3D view" link, via an `isTrusted` `MarkdownString` - VSCode's
   * Markdown renderer specifically honors `command:` links there. Hover computation is
   * itself side-effect-free regardless of how often it's invoked (same as any other
   * hover in this extension), so nothing happens until the user actually clicks the
   * link inside the tooltip. This reuses `openPofViewerAt`/`showPofViewer` - the exact
   * same panel F12 opens/reuses - so mixing F12 and hover-clicks on the same model's
   * different subsystems still lands in one tab, not two.
   *
   * A literal single ctrl+click on the bare `$Subsystem:` text (matching go-to-
   * definition's gesture) was tried via a `DocumentLink` targeting a real `file:` URI
   * routed through a custom editor, but was dropped: VSCode's built-in link-click
   * handler only reliably opens *loose* files that way (a POF packed inside a
   * `.vp`/`.vpc` archive has no real `file:` URI, and a virtual-scheme URI silently
   * failed to open via VSCode's default resource-open codepath no matter what was
   * tried), and even for loose files the custom editor is VSCode's own separate
   * tab-tracking mechanism from this panel - so a user mixing F12 and ctrl+click on the
   * same model's subsystems could end up with two different tabs for it. Not worth the
   * inconsistency for a gesture that only worked for half of the cases; F12 plus this
   * hover link cover both loose and VP-archived models identically.
   */
  const subsystemHoverProvider: HoverProvider = {
    provideHover(document, position) {
      const text = document.lineAt(position.line).text;
      const match = /^\s*\$Subsystem\s*:\s*/i.exec(text);
      if (!match) {
        return undefined;
      }
      const args = encodeURIComponent(JSON.stringify([document.uri.toString(), position.line]));
      const markdown = new MarkdownString(`[$(eye) Open 3D view](command:fsoLsp.openPofViewerAtPosition?${args})`);
      markdown.isTrusted = true;
      markdown.supportThemeIcons = true;
      return new Hover(markdown);
    },
  };
  context.subscriptions.push(languages.registerHoverProvider({ language: "fso-table" }, subsystemHoverProvider));

  /** Invoked only by the hover link below - opens (or reveals) the synthesized effective-definition document for the entry at `line`. */
  context.subscriptions.push(
    commands.registerCommand("fsoLsp.openEffectiveDefinition", async (uriString: string, line: number, displayName: string) => {
      const doc = await workspace.openTextDocument(buildEffectiveDefinitionUri(uriString, line, displayName));
      await window.showTextDocument(doc, { preview: false });
    }),
  );

  /**
   * "Show effective definition" hover link on a ship's/weapon's own `$Name:` line -
   * mirrors subsystemHoverProvider's shape exactly (a separate client-side HoverProvider
   * VSCode merges into the same tooltip as the LSP server's own hover, since LSP
   * MarkupContent has no `isTrusted` concept and the `command:` link trick needs a real
   * `vscode.MarkdownString` built client-side either way). Matched purely by line text +
   * filename (no server round-trip needed just to decide whether to show a link) -
   * SHIP_OR_WEAPON_TABLE_PATTERN mirrors this project's usual filename-based table-kind
   * detection (see server-side schemas/index.ts's fileMatch convention).
   */
  const effectiveDefinitionHoverProvider: HoverProvider = {
    provideHover(document, position) {
      if (!SHIP_OR_WEAPON_TABLE_PATTERN.test(document.uri.fsPath)) {
        return undefined;
      }
      const text = document.lineAt(position.line).text;
      const match = /^\s*\$Name\s*:\s*(.+?)\s*$/i.exec(text);
      if (!match) {
        return undefined;
      }
      const args = encodeURIComponent(JSON.stringify([document.uri.toString(), position.line, match[1]]));
      const markdown = new MarkdownString(`[$(book) Show effective definition](command:fsoLsp.openEffectiveDefinition?${args})`);
      markdown.isTrusted = true;
      markdown.supportThemeIcons = true;
      return new Hover(markdown);
    },
  };
  context.subscriptions.push(languages.registerHoverProvider({ language: "fso-table" }, effectiveDefinitionHoverProvider));
}

export function deactivate(): Thenable<void> | undefined {
  return client ? client.stop() : undefined;
}
