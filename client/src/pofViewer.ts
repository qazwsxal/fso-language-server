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

/**
 * A lightweight fingerprint of a geometry result's actual mesh data - cheap to compare
 * (no need to hash/deep-compare the full positions/normals/uvs arrays), but changes
 * whenever the underlying POF's decoded geometry does (submodel count or any
 * submodel's vertex count). Used to tell "just a different $Subsystem: was F12'd on
 * the same, unchanged model" (safe to re-highlight in place) apart from "the model's
 * own geometry actually changed since we last rendered it" (e.g. the .pof was edited
 * on disk while the viewer stayed open - needs a real re-render).
 */
function fingerprint(result: PofGeometryForSubsystemResult): string {
  return result.submodels.map((s) => s.positions.length).join(",");
}

interface OpenPanel {
  panel: vscode.WebviewPanel;
  fingerprint: string;
}

/** Keyed by model filename (lowercased) so re-triggering F12 on a different subsystem of the same already-open model reuses the panel instead of spawning a second one. */
const openPanels = new Map<string, OpenPanel>();

/**
 * Opens (or reveals/updates an already-open) 3D viewer webview for the given POF
 * geometry result, highlighting `result.targetSubmodelIndex`. Re-triggering F12 on a
 * different `$Subsystem:` of the SAME, unchanged model sends a lightweight
 * highlight-only update (see fingerprint() above) so the webview can just recolor the
 * relevant meshes in place - preserving the user's current camera angle/zoom/pan
 * instead of tearing down and rebuilding the whole scene (which also reset the camera
 * to a default framing every time, making it feel like the panel "reloaded").
 */
export function showPofViewer(context: vscode.ExtensionContext, result: PofGeometryForSubsystemResult): void {
  const key = result.modelFile.toLowerCase();
  const existing = openPanels.get(key);
  if (existing) {
    existing.panel.reveal(vscode.ViewColumn.Beside, true);
    const newFingerprint = fingerprint(result);
    if (newFingerprint === existing.fingerprint) {
      existing.panel.webview.postMessage({ type: "highlight", targetSubmodelIndex: result.targetSubmodelIndex });
    } else {
      existing.fingerprint = newFingerprint;
      existing.panel.webview.postMessage({ type: "geometry", ...result });
    }
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
  const entry: OpenPanel = { panel, fingerprint: fingerprint(result) };
  openPanels.set(key, entry);
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
