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
  DocumentLink,
  DocumentLinkProvider,
  Range,
} from "vscode";
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";
import { showPofViewer, PofGeometryForSubsystemResult } from "./pofViewer";
import { registerPofCustomEditor } from "./pofCustomEditor";

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

  /** Invoked only by the hover link below - see its doc comment for why this is a separate, explicit-args command rather than reading the active editor's cursor position. */
  context.subscriptions.push(
    commands.registerCommand("fsoLsp.openPofViewerAtPosition", (uriString: string, line: number) => {
      void openPofViewerAt(uriString, line);
    }),
  );

  /**
   * Attempted to restore ctrl+click for `$Subsystem:` lines via a `DocumentLink`
   * (provideDocumentLinks is computed once per document, not on every ctrl+hover mouse
   * move, so it doesn't have the DefinitionProvider hover-bug fixed above) - but a
   * DocumentLink's `command:`-scheme target turns out NOT to be honored the way a
   * trusted MarkdownString's is: VSCode's built-in "open this link" handler treats
   * `target` purely as a resource to open (effectively via `vscode.open`), not as a
   * command to execute, so clicking it did nothing. Confirmed in practice (ctrl+click
   * silently not working) after implementing it - the API surface allows constructing
   * such a link, it just isn't wired up to actually run commands.
   *
   * A `Hover` whose content is an `isTrusted` `MarkdownString` IS a genuinely reliable,
   * documented way to run a command from a click - VSCode's Markdown renderer
   * specifically special-cases `command:` links there (unlike the generic document-link
   * opener above). Hover computation is itself side-effect-free regardless of how often
   * it's invoked (it can't be, any more than it already is for every other hover in this
   * extension), so this doesn't reintroduce the earlier bug: nothing happens until the
   * user actually clicks the "Open 3D view" link inside the tooltip. This trades a
   * literal single ctrl+click on the bare text for "hover, then click the link in the
   * tooltip" - not pixel-identical to go-to-definition's gesture, but the closest
   * reliably-working mouse-driven equivalent; F12 remains the exact one-step gesture.
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

  /**
   * A genuine, single-gesture ctrl+click for `$Subsystem:` lines - unlike the earlier
   * DocumentLink attempt (which pointed at a `command:` URI VSCode doesn't honor as
   * a command; see the hover-provider doc comment above), this link's target is a REAL
   * `file:` URI for the resolved POF file, with the target subsystem name carried in
   * the query string. Opening a real resource is something VSCode's built-in "open
   * this link" handler genuinely does support, and since `.pof` is registered as the
   * default editor for pofCustomEditor.ts's viewer (see package.json's
   * `customEditors`), VSCode opens the 3D view instead of trying to show binary
   * garbage as text - so this reproduces the original literal ctrl+click UX.
   *
   * Only offered for subsystems whose model resolves to a loose file (not one inside a
   * .vp/.vpc archive - there's no real filesystem path to point a `file:` URI at for
   * those), and computed once per document via a single request rather than one
   * round trip per `$Subsystem:` line.
   */
  const subsystemLinkProvider: DocumentLinkProvider = {
    async provideDocumentLinks(document) {
      try {
        await clientReady;
        const infos = await client.sendRequest<{ line: number; pofPath: string; subsystemName: string }[]>(
          "fso-lsp/getPofSubsystemLinks",
          { uri: document.uri.toString() },
        );
        const links: DocumentLink[] = [];
        for (const { line, pofPath, subsystemName } of infos) {
          if (line >= document.lineCount) {
            continue;
          }
          const text = document.lineAt(line).text;
          const nameStart = text.indexOf(subsystemName);
          if (nameStart === -1) {
            continue;
          }
          const target = Uri.file(pofPath).with({ query: `subsystem=${encodeURIComponent(subsystemName)}` });
          const link = new DocumentLink(new Range(line, nameStart, line, nameStart + subsystemName.length), target);
          link.tooltip = "Open 3D view";
          links.push(link);
        }
        return links;
      } catch {
        return [];
      }
    },
  };
  context.subscriptions.push(languages.registerDocumentLinkProvider({ language: "fso-table" }, subsystemLinkProvider));

  context.subscriptions.push(...registerPofCustomEditor(context, client, clientReady));
}

export function deactivate(): Thenable<void> | undefined {
  return client ? client.stop() : undefined;
}
