import * as path from "path";
import * as vscode from "vscode";

/** Mirrors the server's PofGeometryForSubsystemResult (server/src/server.ts) - the two aren't imported directly since client/server are separate build targets, but must stay in sync. */
export interface SubmodelGeometryPayload {
  name: string;
  parentIndex: number;
  offset: [number, number, number];
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

export interface PofGeometryForSubsystemResult {
  modelFile: string;
  targetSubmodelIndex: number;
  submodels: SubmodelGeometryPayload[];
}

/** Keyed by model filename (lowercased) so re-triggering F12 on a different subsystem of the same already-open model reuses the panel instead of spawning a second one. */
const openPanels = new Map<string, vscode.WebviewPanel>();

/** Opens (or reveals/updates an already-open) 3D viewer webview for the given POF geometry result, highlighting `result.targetSubmodelIndex`. */
export function showPofViewer(context: vscode.ExtensionContext, result: PofGeometryForSubsystemResult): void {
  const key = result.modelFile.toLowerCase();
  const existing = openPanels.get(key);
  if (existing) {
    existing.reveal(vscode.ViewColumn.Beside, true);
    existing.webview.postMessage({ type: "geometry", ...result });
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "fsoPofViewer",
    `POF: ${path.basename(result.modelFile)}`,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(context.asAbsolutePath("dist"))],
    },
  );
  openPanels.set(key, panel);
  panel.onDidDispose(() => openPanels.delete(key));

  // Registered before setting `webview.html` so the webview's initial "ready" message
  // (sent as soon as its script runs) can't arrive before we're listening for it.
  panel.webview.onDidReceiveMessage((msg: { type?: string }) => {
    if (msg?.type === "ready") {
      panel.webview.postMessage({ type: "geometry", ...result });
    }
  });

  const webviewJsUri = panel.webview.asWebviewUri(
    vscode.Uri.file(context.asAbsolutePath(path.join("dist", "pofViewerWebview.js"))),
  );
  const nonce = getNonce();

  panel.webview.html = `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}'; style-src ${panel.webview.cspSource} 'unsafe-inline';">
<style>
  html, body, #viewer-root { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #1e1e1e; }
</style>
</head>
<body>
<div id="viewer-root"></div>
<script nonce="${nonce}" src="${webviewJsUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
