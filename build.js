const esbuild = require("esbuild");
const path = require("path");

const isWatch = process.argv.includes("--watch");

/**
 * Logs begin/end markers on every rebuild, matched by the "background" begin/end
 * patterns in .vscode/tasks.json so VSCode knows when a watch rebuild has finished and
 * it's safe to launch the debug session that depends on it (see the "Launch Client"
 * preLaunchTask). Doesn't attempt to surface individual esbuild errors as VSCode
 * Problems-panel diagnostics - they still print to this task's terminal output.
 */
function watchLogger(name) {
  return {
    name: `watch-logger-${name}`,
    setup(build) {
      build.onStart(() => {
        console.log(`[watch] build started (${name})`);
      });
      build.onEnd((result) => {
        console.log(`[watch] build finished${result.errors.length > 0 ? " with errors" : ""} (${name})`);
      });
    },
  };
}

/**
 * Bundles both the server and the extension client into client/dist/, so the shipped
 * extension is a single self-contained package rather than reaching into a sibling
 * workspace package's own build output (as the dev-only tsc-based build did before).
 * The server has no dependency on the `vscode` module, so it's a plain Node bundle;
 * the client bundle marks `vscode` external since that module is only ever provided
 * by the running VSCode process, never resolvable at bundle time.
 */
const serverConfig = {
  entryPoints: [path.join(__dirname, "server/src/server.ts")],
  outfile: path.join(__dirname, "client/dist/server.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  sourcemap: true,
  target: "node18",
  plugins: [watchLogger("server")],
};

const clientConfig = {
  entryPoints: [path.join(__dirname, "client/src/extension.ts")],
  outfile: path.join(__dirname, "client/dist/extension.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  sourcemap: true,
  target: "node18",
  external: ["vscode"],
  plugins: [watchLogger("client")],
};

/**
 * The 3D POF viewer's webview content script (client/src/webview/pofViewerMain.ts).
 * Bundled separately from the extension itself since it runs in a completely
 * different environment (a sandboxed browser context inside a VSCode webview, not the
 * Node extension host) - `platform: "browser"` avoids pulling in any Node built-ins,
 * and `format: "iife"` produces a plain <script>-loadable bundle since a webview has
 * no module loader of its own. three.js (including its OrbitControls example module)
 * is bundled in directly rather than fetched at runtime - a webview's CSP only allows
 * scripts from resources the extension host explicitly grants via asWebviewUri(), so
 * a CDN `<script src>` would be silently blocked.
 */
const webviewConfig = {
  entryPoints: [path.join(__dirname, "client/src/webview/pofViewerMain.ts")],
  outfile: path.join(__dirname, "client/dist/pofViewerWebview.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  sourcemap: true,
  target: "es2020",
  plugins: [watchLogger("pofViewerWebview")],
};

async function main() {
  if (isWatch) {
    const [serverCtx, clientCtx, webviewCtx] = await Promise.all([
      esbuild.context(serverConfig),
      esbuild.context(clientConfig),
      esbuild.context(webviewConfig),
    ]);
    await Promise.all([serverCtx.watch(), clientCtx.watch(), webviewCtx.watch()]);
    console.log("esbuild watching server + client for changes...");
  } else {
    await Promise.all([esbuild.build(serverConfig), esbuild.build(clientConfig), esbuild.build(webviewConfig)]);
    console.log("esbuild build complete: client/dist/{extension,server,pofViewerWebview}.js");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
