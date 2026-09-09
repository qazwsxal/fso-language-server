// Wraps `vsce package` and passes the flags this monorepo needs every time:
// --no-dependencies because the extension is fully pre-bundled by esbuild
// (see ../../build.js), so vsce's own npm-workspaces dependency walk is
// unnecessary and (due to hoisted node_modules) pulls in the entire repo;
// --allow-missing-repository because package.json has no repository field
// until this project is pushed somewhere.
const { createVSIX } = require("@vscode/vsce");

createVSIX({
  cwd: __dirname + "/..",
  dependencies: false,
  allowMissingRepository: true,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
