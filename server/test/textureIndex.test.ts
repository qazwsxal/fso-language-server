import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildTextureIndex } from "../src/textureIndex";

test("buildTextureIndex recognizes a standalone LZ41-compressed loose texture (real Solaris 3.0.2 shape: data/maps/*.dds.lz41)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fso-lsp-textureindex-test-"));
  try {
    fs.mkdirSync(path.join(dir, "data", "maps"), { recursive: true });
    fs.writeFileSync(path.join(dir, "data", "maps", "cockpit-reflect.dds.lz41"), "fake compressed bytes");

    const index = buildTextureIndex([dir]);
    const entry = index.get("cockpit-reflect");
    assert.ok(entry, "expected 'cockpit-reflect' (bare name, .lz41 and .dds both stripped) to be indexed");
    assert.equal(entry!.kind, "loose");
    assert.ok(entry!.containerPath.endsWith("cockpit-reflect.dds.lz41"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("buildTextureIndex still ignores a file whose real extension (after stripping .lz41) isn't a known texture type", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fso-lsp-textureindex-test-"));
  try {
    fs.mkdirSync(path.join(dir, "data", "maps"), { recursive: true });
    fs.writeFileSync(path.join(dir, "data", "maps", "readme.txt.lz41"), "fake compressed bytes");

    const index = buildTextureIndex([dir]);
    assert.equal(index.has("readme"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
