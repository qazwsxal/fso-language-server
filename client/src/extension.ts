import * as path from "path";
import { commands, ExtensionContext, window, workspace, Uri, TextDocumentContentProvider } from "vscode";
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
   * perform the side effect. Ctrl+click can't be given the same treatment - it's a mouse
   * gesture handled by VSCode's own DefinitionProvider dispatch, with no separate
   * "this was an explicit click, not a hover preview" signal available to an extension -
   * so ctrl+click on a `$Subsystem:` line falls through to normal (no-op) behavior
   * rather than risk reintroducing the same accidental-open-on-hover bug. Every other
   * cross-reference (armor type, species, weapon names, ...) is unaffected: those are
   * pure navigation with no side effect, so the server's own onDefinition/onDeclaration
   * already handles them correctly for both F12 and ctrl+click via the normal LSP path.
   */
  context.subscriptions.push(
    commands.registerCommand("fsoLsp.revealDefinitionOrPofViewer", async () => {
      const editor = window.activeTextEditor;
      if (editor && editor.document.languageId === "fso-table") {
        try {
          await clientReady;
          const result = await client.sendRequest<PofGeometryForSubsystemResult | null>(
            "fso-lsp/getPofGeometryForSubsystem",
            { uri: editor.document.uri.toString(), line: editor.selection.active.line },
          );
          if (result) {
            showPofViewer(context, result);
            return;
          }
        } catch {
          // Fall through to normal go-to-definition below.
        }
      }
      await commands.executeCommand("editor.action.revealDefinition");
    }),
  );
}

export function deactivate(): Thenable<void> | undefined {
  return client ? client.stop() : undefined;
}
