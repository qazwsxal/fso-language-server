import * as path from "path";
import {
  commands,
  ExtensionContext,
  window,
  workspace,
  languages,
  Uri,
  TextDocumentContentProvider,
  DocumentLink,
  DocumentLinkProvider,
  Range,
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

  /** Invoked only by the DocumentLink below - see its doc comment for why this is a separate, explicit-args command rather than reading the active editor's cursor position. */
  context.subscriptions.push(
    commands.registerCommand("fsoLsp.openPofViewerAtPosition", (uriString: string, line: number) => {
      void openPofViewerAt(uriString, line);
    }),
  );

  /**
   * Restores ctrl+click for `$Subsystem:` lines specifically, using a *different*
   * VSCode mechanism than go-to-definition: a DocumentLink. Unlike a DefinitionProvider,
   * `provideDocumentLinks` is called once per document (re-parse), not on every
   * ctrl+hover mouse move, and is itself side-effect-free - it only returns link ranges
   * + targets for VSCode to underline. The side effect (opening the viewer) only runs
   * when the link's target `command:` URI is actually activated by a real click -
   * VSCode's documented gesture for that is the same Ctrl/Cmd+Click used for go-to-
   * definition (see the `DocumentLink.tooltip` doc comment: "{0} (ctrl + click)"), so
   * this reproduces the original ctrl+click UX without reintroducing the hover bug
   * fixed above. The target is a `command:` URI carrying explicit (uri, line) arguments
   * - see openPofViewerAtPosition above - rather than reading the active editor's
   * current cursor position, since a link click has no guaranteed effect on the
   * cursor/selection.
   */
  const subsystemLinkProvider: DocumentLinkProvider = {
    provideDocumentLinks(document) {
      const links: DocumentLink[] = [];
      for (let line = 0; line < document.lineCount; line++) {
        const text = document.lineAt(line).text;
        const match = /^\s*\$Subsystem\s*:\s*/i.exec(text);
        if (!match) {
          continue;
        }
        const nameStart = match[0].length;
        const commaIdx = text.indexOf(",", nameStart);
        let nameEnd = commaIdx === -1 ? text.length : commaIdx;
        while (nameEnd > nameStart && /\s/.test(text[nameEnd - 1])) {
          nameEnd--;
        }
        if (nameEnd <= nameStart) {
          continue;
        }
        const args = encodeURIComponent(JSON.stringify([document.uri.toString(), line]));
        const link = new DocumentLink(
          new Range(line, nameStart, line, nameEnd),
          Uri.parse(`command:fsoLsp.openPofViewerAtPosition?${args}`),
        );
        link.tooltip = "Open 3D view";
        links.push(link);
      }
      return links;
    },
  };
  context.subscriptions.push(languages.registerDocumentLinkProvider({ language: "fso-table" }, subsystemLinkProvider));
}

export function deactivate(): Thenable<void> | undefined {
  return client ? client.stop() : undefined;
}
