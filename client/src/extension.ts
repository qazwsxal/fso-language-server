import * as path from "path";
import { ExtensionContext, workspace } from "vscode";
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";

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
  client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client ? client.stop() : undefined;
}
