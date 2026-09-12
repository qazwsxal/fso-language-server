import * as fs from "fs";
import * as path from "path";
import { readVpIndex, isVpArchiveFilename } from "./vp/reader";
import { ResolvedFile } from "./modResolution/resolver";

/**
 * Directories FSO tables' bitmap/animation fields conventionally reference, relative
 * to a mod's root. This project hasn't traced which exact field pulls from which of
 * these (that would need per-field source confirmation, same caveat as everywhere else
 * in this codebase) - textures found under ANY of them are merged into one lookup set,
 * which risks completion offering a texture from an unrelated category but is a
 * reasonable, low-risk simplification for existence-checking and completion alike.
 */
const TEXTURE_DIRS = ["data/maps", "data/effects", "data/hud", "data/interface", "data/cbanims"];

const TEXTURE_EXTENSIONS = new Set(["dds", "tga", "pcx", "png", "jpg", "jpeg", "ani", "eff"]);

/** Strips a known texture/animation extension and returns the bare, lowercased basename - FSO table fields reference textures without an extension. */
function bareName(filename: string): string | null {
  // A loose texture file can be individually LZ41-compressed on disk as
  // `<name>.<ext>.lz41` (see resolver.ts's resolveFile() doc comment - confirmed
  // against a real Solaris 3.0.2 install, where every data/maps texture is stored this
  // way) - strip that suffix first so the real extension underneath is what gets
  // checked against TEXTURE_EXTENSIONS.
  const withoutLz41 = /\.lz41$/i.test(filename) ? filename.slice(0, -".lz41".length) : filename;
  const ext = path.extname(withoutLz41).slice(1).toLowerCase();
  if (!TEXTURE_EXTENSIONS.has(ext)) {
    return null;
  }
  return path.basename(withoutLz41, path.extname(withoutLz41)).toLowerCase();
}

/**
 * Builds a lookup of every known texture/animation base name (lowercased, no
 * extension) to WHERE it was found - across the given search-path directories, loose
 * files under each TEXTURE_DIRS entry, plus matching entries inside every .vp/.vpc
 * archive in each directory (some entries' payload bytes may be LZ41-compressed inside
 * a .vpc, but that doesn't matter here - only the uncompressed directory/index is
 * read, see vp-container-format memory). First occurrence wins as directories/archives
 * are visited in search-path priority order (loose before .vp/.vpc within a directory,
 * matching resolveFile()'s own precedence) - so the recorded location for a name is the
 * one that would actually win at runtime, useful for hover ("where is this texture
 * actually coming from").
 */
export function buildTextureIndex(searchDirs: string[]): Map<string, ResolvedFile> {
  const index = new Map<string, ResolvedFile>();
  const record = (name: string, resolved: ResolvedFile) => {
    if (!index.has(name)) {
      index.set(name, resolved);
    }
  };

  for (const dir of searchDirs) {
    for (const texDir of TEXTURE_DIRS) {
      const fullDir = path.join(dir, ...texDir.split("/"));
      try {
        for (const f of fs.readdirSync(fullDir)) {
          const name = bareName(f);
          if (name) {
            record(name, { kind: "loose", containerPath: path.join(fullDir, f) });
          }
        }
      } catch {
        // No such loose directory here - fine, may live in a VP instead.
      }
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
          if (TEXTURE_DIRS.some((texDir) => entry.path.toLowerCase().startsWith(`${texDir.toLowerCase()}/`))) {
            const name = bareName(entry.path);
            if (name) {
              record(name, { kind: "vp", containerPath: vpPath, entryPath: entry.path });
            }
          }
        }
      } catch {
        // Malformed/unreadable VP - skip it, other directories may still contribute.
      }
    }
  }

  return index;
}
