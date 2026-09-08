import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { buildPofViewerHtml, PofGeometryForSubsystemResult } from "./pofViewer";

const VIEW_TYPE = "fsoLsp.pofViewer";

/**
 * Lets VSCode's own "open this resource" machinery open a `.pof` file directly into the
 * 3D viewer - registered as the default editor for `*.pof` (see package.json's
 * `customEditors`). This is what makes a genuine ctrl+click on a `$Subsystem:` line
 * work (see the DocumentLinkProvider in extension.ts, whose link targets a real
 * `file:` URI for the resolved POF, with the subsystem name carried in the query
 * string): clicking a link with a `file:` target is a real "open this resource" action
 * VSCode always honors, unlike a `command:` target (see the DocumentLink attempt this
 * replaced, and the trusted-hover-link attempt before that - both documented in git
 * history/prior commits). Double-clicking a .pof in the Explorer, or opening one via
 * any other normal means, benefits the same way instead of showing raw binary as text.
 *
 * Deliberately independent of pofViewer.ts's own openPanels/highlight-in-place
 * machinery: VSCode owns this panel's entire lifecycle (creation, tab reuse, disposal),
 * unlike a panel this extension creates itself via `createWebviewPanel`. F12 still goes
 * through pofViewer.ts's showPofViewer() unchanged - only the DocumentLink-triggered
 * open path uses this, so the two can end up as separate panels for the same model if
 * a user mixes F12 and ctrl+click on different subsystems of the same ship. Unifying
 * them would mean giving up one mechanism's proven, tested behavior for the other's -
 * not attempted here.
 *
 * Confirmed empirically (see the extension test suite, not assumed): opening the same
 * .pof path again with a DIFFERENT `?subsystem=` query reuses the SAME tab rather than
 * opening a second one, AND `resolveCustomEditor` genuinely runs again each time (the
 * `_debugGetPofCustomEditorResolveCount` command below exists solely to verify this,
 * since there's no public API to inspect a webview's live rendered content) - so the
 * highlighted subsystem does update on each click, it's just a full reload rather than
 * pofViewer.ts's in-place recolor (VSCode reassigns `webview.html` fresh each
 * resolveCustomEditor call, there's no hook to intercept that and diff instead).
 */
class PofDocument implements vscode.CustomDocument {
  constructor(public readonly uri: vscode.Uri) {}
  dispose(): void {
    // No held resources - geometry is fetched fresh each time resolveCustomEditor runs.
  }
}

/** Test-only introspection: how many times resolveCustomEditor has run this session - lets the test suite tell "same tab, never re-resolved" apart from "same tab, re-resolved with new content" (no public VSCode API exposes a webview's live content to inspect directly). */
let resolveCustomEditorCallCount = 0;

export function registerPofCustomEditor(
  context: vscode.ExtensionContext,
  client: LanguageClient,
  clientReady: Promise<unknown>,
): vscode.Disposable[] {
  const provider: vscode.CustomReadonlyEditorProvider<PofDocument> = {
    openCustomDocument(uri: vscode.Uri): PofDocument {
      return new PofDocument(uri);
    },
    async resolveCustomEditor(document: PofDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
      resolveCustomEditorCallCount++;
      webviewPanel.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(context.asAbsolutePath("dist"))],
      };
      webviewPanel.webview.html = buildPofViewerHtml(context, webviewPanel.webview);

      const subsystemName = new URLSearchParams(document.uri.query).get("subsystem");
      const pofPath = document.uri.fsPath;

      webviewPanel.webview.onDidReceiveMessage(async (msg: { type?: string }) => {
        if (msg?.type !== "ready") {
          return;
        }
        try {
          await clientReady;
          const result = await client.sendRequest<PofGeometryForSubsystemResult | null>("fso-lsp/getPofGeometryByPath", {
            pofPath,
            targetSubmodelName: subsystemName,
          });
          if (result) {
            webviewPanel.webview.postMessage({ type: "geometry", ...result });
          }
        } catch {
          // Leave the webview showing nothing rather than throwing into VSCode's editor-resolution machinery.
        }
      });
    },
  };

  return [
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.commands.registerCommand("fsoLsp._debugGetPofCustomEditorResolveCount", () => resolveCustomEditorCallCount),
  ];
}
