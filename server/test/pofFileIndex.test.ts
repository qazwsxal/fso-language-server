import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildPofFileIndex } from "../src/pofFileIndex";

test("buildPofFileIndex recognizes a standalone LZ41-compressed loose POF, keyed by its logical (uncompressed) filename (real Solaris 3.0.2 shape: data/models/*.pof.lz41)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fso-lsp-pofindex-test-"));
  try {
    fs.mkdirSync(path.join(dir, "data", "models"), { recursive: true });
    fs.writeFileSync(path.join(dir, "data", "models", "cockpit.pof.lz41"), "fake compressed bytes");

    const index = buildPofFileIndex([dir]);
    const entry = index.get("cockpit.pof");
    assert.ok(entry, "expected 'cockpit.pof' (the logical name modders reference) to be indexed");
    assert.equal(entry!.displayName, "cockpit.pof");
    assert.equal(entry!.resolved.kind, "loose");
    assert.ok(entry!.resolved.containerPath.endsWith("cockpit.pof.lz41"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildPofFileIndex still recognizes an ordinary, uncompressed loose .pof", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fso-lsp-pofindex-test-"));
  try {
    fs.mkdirSync(path.join(dir, "data", "models"), { recursive: true });
    fs.writeFileSync(path.join(dir, "data", "models", "fighter1.pof"), "fake bytes");

    const index = buildPofFileIndex([dir]);
    const entry = index.get("fighter1.pof");
    assert.ok(entry);
    assert.equal(entry!.displayName, "fighter1.pof");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
