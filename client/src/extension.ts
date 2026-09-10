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
    documentSelector: [
      { scheme: "file", language: "fso-table" },
      // A .tbl/.tbm go-to-definition target that lives inside a .vp/.vpc archive opens
      // read-only through vpContentProvider below, under the fso-tbl-vp: scheme rather
      // than file: - without also matching that scheme here, such a document would
      // never reach the server at all (no textDocument/didOpen sent for it), silently
      // losing every LSP feature - diagnostics, hover, go-to-definition, and F12's POF
      // viewer - not just the ones that happen to depend on filesystem access.
      { scheme: VP_CONTENT_SCHEME, language: "fso-table" },
      // .fs2/.fc2 missions get ship-class/weapon-name cross-referencing against
      // ships.tbl/weapons.tbl (see server.ts's missionEntriesByUri) - not full mission
      // parsing, so unlike fso-table this carries no diagnostics of its own.
      { scheme: "file", language: "fso-mission" },
    ],
    synchronize: {
      // Lets the server pull `fsoLsp.*` settings via workspace/configuration and be
      // notified (workspace/didChangeConfiguration) whenever the user changes one.
      configurationSection: "fsoLsp",
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
   * model instead of navigating to a text location; F12 on its `$POF file:` line does
   * the same, opening the model with no particular submodel highlighted (see
   * server.ts's getPofGeometryForSubsystem handler, which also matches that line). This
   * is deliberately NOT
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
      // Matches both `$Subsystem:` (opens the model highlighting that submodel) and
      // `$POF file:` (opens the model with nothing highlighted) - server.ts's
      // getPofGeometryForSubsystem handler resolves either line the same way.
      const match = /^\s*\$(Subsystem|POF file)\s*:\s*/i.exec(text);
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
}

export function deactivate(): Thenable<void> | undefined {
  return client ? client.stop() : undefined;
}
