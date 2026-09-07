import * as path from "path";
import { ExtensionContext, languages, workspace, Position, TextDocument } from "vscode";
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";
import { showPofViewer, PofGeometryForSubsystemResult } from "./pofViewer";

let client: LanguageClient;

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
      // truth) / mod.ini (fallback) search-path changes, referenced .pof models, .vp
      // archives, and texture/animation files - watch all of them so the server can
      // invalidate on change.
      fileEvents: [
        workspace.createFileSystemWatcher("**/*.{tbl,tbm}"),
        workspace.createFileSystemWatcher("**/*.pof"),
        workspace.createFileSystemWatcher("**/*.vp"),
        workspace.createFileSystemWatcher("**/mod.json"),
        workspace.createFileSystemWatcher("**/mod.ini"),
        workspace.createFileSystemWatcher("**/*.{dds,tga,pcx,png,jpg,jpeg,ani,eff}"),
      ],
    },
  };

  client = new LanguageClient("fsoLsp", "FSO Table Language Server", serverOptions, clientOptions);
  const clientReady = client.start(); // vscode-languageclient v9: start() itself resolves once initialized (no separate onReady()).

  // F12 on a ship's `$Subsystem:` line opens an explorable 3D view of that ship's POF
  // model (highlighting the matching submodel) instead of navigating to a text
  // location - LSP's textDocument/definition can only return text Locations, so this
  // interception has to happen client-side. The server's custom
  // "fso-lsp/getPofGeometryForSubsystem" request tells us in one round trip both
  // whether `position` is a subsystem line AND (if so) the decoded geometry to show;
  // for any other line it resolves to null and this provider returns undefined so the
  // server's own textDocument/definition results (if any, from an unrelated feature)
  // are used normally instead.
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
