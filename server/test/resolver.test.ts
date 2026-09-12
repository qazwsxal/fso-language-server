import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildSearchPath, resolveFile, readResolvedFile } from "../src/modResolution/resolver";

/** Builds a minimal single-block, literals-only LZ41 buffer wrapping `content` - see vpReader.test.ts's buildLz41() for the full trailer-layout doc comment; duplicated narrowly here since that helper isn't exported. */
function buildLz41(content: Buffer): Buffer {
  const header = Buffer.from("LZ41", "ascii");
  const block = Buffer.concat([Buffer.from([content.length << 4]), content]);
  const offsets = [header.length, header.length + block.length];
  const offsetsBuf = Buffer.alloc(offsets.length * 4);
  offsets.forEach((o, i) => offsetsBuf.writeInt32LE(o, i * 4));
  const counts = Buffer.alloc(12);
  counts.writeInt32LE(offsets.length, 0);
  counts.writeInt32LE(content.length, 4);
  counts.writeInt32LE(65536, 8);
  return Buffer.concat([header, block, offsetsBuf, counts]);
}

/**
 * Builds a temp Knossos library root with a mod (mod_flag = [self, "MVPS"], and a
 * packages[].dependencies[] constraint of "~4.6.8" on MVPS) plus several installed
 * MVPS-* versions, mirroring the real shape of a Blue Planet Complete install that
 * confirmed this bug: mod_flag alone carries no version info, so resolving it naively
 * grabs whichever MVPS-* folder happens to be newest on disk instead of the one the
 * mod's own dependency constraint actually calls for.
 */
function makeFixture(): { libraryRoot: string; tablePath: string } {
  const libraryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fso-lsp-resolver-test-"));

  const modDir = path.join(libraryRoot, "mymod-1.0.0");
  fs.mkdirSync(path.join(modDir, "data", "tables"), { recursive: true });
  fs.writeFileSync(
    path.join(modDir, "mod.json"),
    JSON.stringify({
      id: "mymod",
      version: "1.0.0",
      mod_flag: ["mymod", "MVPS"],
      packages: [
        {
          name: "core",
          isEnabled: true,
          dependencies: [{ id: "MVPS", version: "~4.6.8" }],
        },
      ],
    }),
  );
  const tablePath = path.join(modDir, "data", "tables", "weapons.tbl");
  fs.writeFileSync(tablePath, "#Primary Weapons\n#End\n");

  for (const version of ["4.6.2", "4.6.8", "4.7.3", "5.0.2"]) {
    const dir = path.join(libraryRoot, `MVPS-${version}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "mod.json"), JSON.stringify({ id: "MVPS", version }));
  }

  return { libraryRoot, tablePath };
}

test("buildSearchPath honors a mod_flag dependency's real version constraint instead of grabbing the newest installed copy", () => {
  const { libraryRoot, tablePath } = makeFixture();
  try {
    const dirs = buildSearchPath(tablePath);
    const mvpsDirs = dirs.filter((d) => path.basename(d).startsWith("MVPS-"));
    assert.deepEqual(
      mvpsDirs.map((d) => path.basename(d)),
      ["MVPS-4.6.8"],
      `expected only the ~4.6.8-satisfying MVPS-4.6.8 on the search path, got: ${JSON.stringify(dirs.map((d) => path.basename(d)))}`,
    );
  } finally {
    fs.rmSync(libraryRoot, { recursive: true, force: true });
  }
});

test("buildSearchPath drops a mod_flag dependency entirely when no installed version satisfies its constraint (matches Knossos.NET's own 'missing dependency' behavior, no silent substitution)", () => {
  const { libraryRoot, tablePath } = makeFixture();
  try {
    // Remove the one version that actually satisfies ~4.6.8, leaving only mismatched ones.
    fs.rmSync(path.join(libraryRoot, "MVPS-4.6.8"), { recursive: true, force: true });

    const dirs = buildSearchPath(tablePath);
    const mvpsDirs = dirs.filter((d) => path.basename(d).startsWith("MVPS-"));
    assert.deepEqual(mvpsDirs, [], `expected no MVPS folder on the search path when none satisfy ~4.6.8, got: ${JSON.stringify(dirs.map((d) => path.basename(d)))}`);
  } finally {
    fs.rmSync(libraryRoot, { recursive: true, force: true });
  }
});

test("resolveFile finds a standalone LZ41-compressed loose file (real Solaris 3.0.2 shape: every data/models/data/maps asset stored as <name>.<ext>.lz41)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fso-lsp-lz41-test-"));
  try {
    fs.mkdirSync(path.join(dir, "data", "models"), { recursive: true });
    const content = Buffer.from("fake POF bytes", "ascii");
    fs.writeFileSync(path.join(dir, "data", "models", "cockpit.pof.lz41"), buildLz41(content));

    const resolved = resolveFile([dir], "data/models/cockpit.pof");
    assert.ok(resolved);
    assert.equal(resolved!.kind, "loose");
    assert.ok(resolved!.containerPath.endsWith("cockpit.pof.lz41"));

    // readResolvedFile() must transparently decompress it back to the real bytes -
    // this is exactly the path the 3D model viewer's pofCache.ts reads through.
    const bytes = readResolvedFile(resolved!);
    assert.equal(bytes.toString("ascii"), "fake POF bytes");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveFile still prefers an uncompressed loose file over a same-named .lz41 one, if somehow both exist", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fso-lsp-lz41-test-"));
  try {
    fs.mkdirSync(path.join(dir, "data", "models"), { recursive: true });
    fs.writeFileSync(path.join(dir, "data", "models", "cockpit.pof"), "real uncompressed bytes");
    fs.writeFileSync(path.join(dir, "data", "models", "cockpit.pof.lz41"), buildLz41(Buffer.from("stale", "ascii")));

    const resolved = resolveFile([dir], "data/models/cockpit.pof");
    assert.ok(resolved);
    assert.ok(resolved!.containerPath.endsWith("cockpit.pof") && !resolved!.containerPath.endsWith(".lz41"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
