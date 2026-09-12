import * as fs from "fs";
import * as path from "path";
import { readVpIndex, isVpArchiveFilename } from "./vp/reader";
import { ResolvedFile } from "./modResolution/resolver";

/** FSO looks for POF models under `data/models/` - see resolveModelFile()'s doc comment in modResolution/resolver.ts. */
const MODEL_DIR = "data/models";

export interface PofFileIndexEntry {
  /** The filename as it actually appears on disk/in the archive, WITH its `.pof` extension - unlike textureIndex.ts's bare names, `$POF file:` values are given with the extension and, on a case-sensitive filesystem, must match this exactly. */
  displayName: string;
  resolved: ResolvedFile;
}

/**
 * Builds a lookup of every known `.pof` file (keyed by lowercased filename, for
 * case-insensitive dedup only - see PofFileIndexEntry.displayName for the real,
 * on-disk-cased name completion should actually insert) to where it was found, across
 * the given search-path directories: loose files directly under `data/models/`, plus
 * matching entries inside every .vp/.vpc archive in each directory. Mirrors
 * buildTextureIndex()'s precedence rules (see textureIndex.ts): first occurrence wins
 * as directories/archives are visited in search-path priority order (loose before
 * .vp/.vpc within a directory, matching resolveFile()'s own precedence).
 */
export function buildPofFileIndex(searchDirs: string[]): Map<string, PofFileIndexEntry> {
  const index = new Map<string, PofFileIndexEntry>();
  const record = (displayName: string, resolved: ResolvedFile) => {
    const key = displayName.toLowerCase();
    if (!index.has(key)) {
      index.set(key, { displayName, resolved });
    }
  };

  for (const dir of searchDirs) {
    const fullDir = path.join(dir, ...MODEL_DIR.split("/"));
    try {
      for (const f of fs.readdirSync(fullDir)) {
        // A loose .pof can be individually LZ41-compressed on disk as `<name>.pof.lz41`
        // (see resolver.ts's resolveFile() doc comment - confirmed against a real
        // Solaris 3.0.2 install) - the logical name modders reference is still
        // `<name>.pof`, with the actual `.lz41`-suffixed path kept as containerPath so
        // readResolvedFile() can find and transparently decompress it.
        const logicalName = /\.pof\.lz41$/i.test(f) ? f.slice(0, -".lz41".length) : f;
        if (path.extname(logicalName).toLowerCase() === ".pof") {
          record(logicalName, { kind: "loose", containerPath: path.join(fullDir, f) });
        }
      }
    } catch {
      // No such loose directory here - fine, may live in a VP instead.
    }

    let vpFiles: string[] = [];
    try {
      vpFiles = fs
        .readdirSync(dir)
        .filter((f) => isVpArchiveFilename(f))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      vpFiles = [];
    }
    for (const vpFile of vpFiles) {
      try {
        const vpPath = path.join(dir, vpFile);
        const archive = readVpIndex(vpPath);
        for (const entry of archive.entries) {
          if (entry.path.toLowerCase().startsWith(`${MODEL_DIR}/`) && path.extname(entry.path).toLowerCase() === ".pof") {
            record(path.basename(entry.path), { kind: "vp", containerPath: vpPath, entryPath: entry.path });
          }
        }
      } catch {
        // Malformed/unreadable VP - skip it, other directories may still contribute.
      }
    }
  }

  return index;
}
