import * as fs from "fs";
import * as path from "path";
import { readVpIndex, isVpArchiveFilename } from "./vp/reader";

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
  const ext = path.extname(filename).slice(1).toLowerCase();
  if (!TEXTURE_EXTENSIONS.has(ext)) {
    return null;
  }
  return path.basename(filename, path.extname(filename)).toLowerCase();
}

/**
 * Builds the set of every known texture/animation base name (lowercased, no extension)
 * across the given search-path directories - loose files under each TEXTURE_DIRS entry,
 * plus matching entries inside every .vp/.vpc archive in each directory (some entries'
 * payload bytes may be LZ41-compressed inside a .vpc, but that doesn't matter here -
 * only the uncompressed directory/index is read, see vp-container-format memory).
 */
export function buildTextureIndex(searchDirs: string[]): Set<string> {
  const names = new Set<string>();

  for (const dir of searchDirs) {
    for (const texDir of TEXTURE_DIRS) {
      const fullDir = path.join(dir, ...texDir.split("/"));
      try {
        for (const f of fs.readdirSync(fullDir)) {
          const name = bareName(f);
          if (name) {
            names.add(name);
          }
        }
      } catch {
        // No such loose directory here - fine, may live in a VP instead.
      }
    }

    let vpFiles: string[] = [];
    try {
      vpFiles = fs.readdirSync(dir).filter((f) => isVpArchiveFilename(f));
    } catch {
      vpFiles = [];
    }
    for (const vpFile of vpFiles) {
      try {
        const archive = readVpIndex(path.join(dir, vpFile));
        for (const entry of archive.entries) {
          if (TEXTURE_DIRS.some((texDir) => entry.path.toLowerCase().startsWith(`${texDir.toLowerCase()}/`))) {
            const name = bareName(entry.path);
            if (name) {
              names.add(name);
            }
          }
        }
      } catch {
        // Malformed/unreadable VP - skip it, other directories may still contribute.
      }
    }
  }

  return names;
}
