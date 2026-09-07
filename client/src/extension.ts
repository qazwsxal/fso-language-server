import * as path from "path";
import { ExtensionContext, languages, workspace, Position, TextDocument, Uri, TextDocumentContentProvider } from "vscode";
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

  // F12 on a ship's `$Subsystem:` line opens an explorable 3D view of that ship's POF
  // model (highlighting the matching submodel) instead of navigating to a text
  // location - LSP's textDocument/definition can only return text Locations, so this
  // interception has to happen client-side. The server's custom
  // "fso-lsp/getPofGeometryForSubsystem" request tells us in one round trip both
  // whether `position` is a subsystem line AND (if so) the decoded geometry to show;
  // for any other line it resolves to null and this provider returns undefined so the
  // server's own textDocument/definition results (the armor/damage-type cross-reference
  // feature registered server-side) are used normally instead.
  context.subscriptions.push(
    languages.registerDefinitionProvider({ language: "fso-table" }, {
      async provideDefinition(document: TextDocument, position: Position) {
        try {
          await clientReady;
          const result = await client.sendRequest<PofGeometryForSubsystemResult | null>(
            "fso-lsp/getPofGeometryForSubsystem",
            { uri: document.uri.toString(), line: position.line },
          );
          if (!result) {
            return undefined;
          }
          showPofViewer(context, result);
          return undefined;
        } catch {
          return undefined;
        }
      },
    }),
  );
}

export function deactivate(): Thenable<void> | undefined {
  return client ? client.stop() : undefined;
}
