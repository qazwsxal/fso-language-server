import * as path from "path";
import { runTests } from "@vscode/test-electron";

/**
 * Launches a real (headless-capable) VSCode Extension Development Host with this
 * extension loaded and a fixture mod folder opened as the workspace, then runs the
 * Mocha suite in ./suite/index.ts inside it - actual textDocument/didOpen,
 * publishDiagnostics, and hover requests over the real LSP connection, not just direct
 * calls into the compiled server modules like the smoke tests used during development.
 */
async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");
    const workspacePath = path.resolve(__dirname, "../../test/fixtures/mymod");

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspacePath, "--disable-extensions"],
    });
  } catch (err) {
    console.error("Failed to run extension tests", err);
    process.exit(1);
  }
}

void main();
