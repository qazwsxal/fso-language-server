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

async function main() {
  if (isWatch) {
    const [serverCtx, clientCtx] = await Promise.all([
      esbuild.context(serverConfig),
      esbuild.context(clientConfig),
    ]);
    await Promise.all([serverCtx.watch(), clientCtx.watch()]);
    console.log("esbuild watching server + client for changes...");
  } else {
    await Promise.all([esbuild.build(serverConfig), esbuild.build(clientConfig)]);
    console.log("esbuild build complete: client/dist/{extension,server}.js");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
