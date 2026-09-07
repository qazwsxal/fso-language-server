import * as fs from "fs";

const HEADER_SIGNATURE = "VPVP";
const HEADER_SIZE = 16;
const INDEX_ENTRY_SIZE = 44;

export interface VpEntry {
  /** Forward-slash-joined path within the archive, reconstructed from the directory-marker stack. */
  path: string;
  offset: number;
  size: number;
  timestamp: number;
}

export interface VpArchive {
  entries: VpEntry[];
  /** Case-insensitive path -> entry, for fast lookup. */
  byPath: Map<string, VpEntry>;
}

/**
 * Parses a .VP archive's header + index into a flat entry list, reconstructing the
 * (otherwise tree-less) directory structure via the directory-start/".." backdir stack
 * convention documented in the vp-container-format project memory. Does not read file
 * data itself - see readVpEntry() for that, given an entry from this archive's index.
 */
export function readVpIndex(vpPath: string): VpArchive {
  const fd = fs.openSync(vpPath, "r");
  try {
    const header = Buffer.alloc(HEADER_SIZE);
    fs.readSync(fd, header, 0, HEADER_SIZE, 0);

    const signature = header.toString("ascii", 0, 4);
    if (signature !== HEADER_SIGNATURE) {
      throw new Error(`${vpPath} is not a VP archive (bad signature "${signature}")`);
    }
    const dirOffset = header.readInt32LE(8);
    const dirEntries = header.readInt32LE(12);

    const indexSize = dirEntries * INDEX_ENTRY_SIZE;
    const indexBuf = Buffer.alloc(indexSize);
    fs.readSync(fd, indexBuf, 0, indexSize, dirOffset);

    const entries: VpEntry[] = [];
    const byPath = new Map<string, VpEntry>();
    const pathStack: string[] = [];

    for (let i = 0; i < dirEntries; i++) {
      const base = i * INDEX_ENTRY_SIZE;
      const offset = indexBuf.readInt32LE(base);
      const size = indexBuf.readInt32LE(base + 4);
      const nameRaw = indexBuf.toString("ascii", base + 8, base + 40);
      const name = nameRaw.replace(/\0.*$/, "");
      const timestamp = indexBuf.readInt32LE(base + 40);

      if (size === 0 && name === "..") {
        pathStack.pop();
        continue;
      }
      if (size === 0) {
        // Directory-start marker.
        pathStack.push(name);
        continue;
      }

      const fullPath = [...pathStack, name].join("/");
      const entry: VpEntry = { path: fullPath, offset, size, timestamp };
      entries.push(entry);
      byPath.set(fullPath.toLowerCase(), entry);
    }

    return { entries, byPath };
  } finally {
    fs.closeSync(fd);
  }
}

/** Reads one entry's raw file data out of the archive. */
export function readVpEntry(vpPath: string, entry: VpEntry): Buffer {
  const fd = fs.openSync(vpPath, "r");
  try {
    const buf = Buffer.alloc(entry.size);
    fs.readSync(fd, buf, 0, entry.size, entry.offset);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

/** Case-insensitive, forward-slash-normalized lookup of a path within an already-read archive index. */
export function findVpEntry(archive: VpArchive, relativePath: string): VpEntry | undefined {
  return archive.byPath.get(relativePath.replace(/\\/g, "/").toLowerCase());
}

/**
 * `.vp` and `.vpc` are both real archive extensions in the wild - `.vpc` (confirmed
 * against a real MediaVPs install) is used for archives with one or more LZ41-
 * compressed member payloads (see vp-container-format project memory), but the
 * container's own header/index is identical either way (same "VPVP" signature,
 * version just reads 3 instead of 2) - it's not a distinct format, just a naming
 * convention some mods use. A directory/name listing (readVpIndex) works on either
 * without needing to decompress anything, since only entry *payload* bytes are ever
 * compressed, never the index itself.
 */
export function isVpArchiveFilename(filename: string): boolean {
  return /\.vpc?$/i.test(filename);
}
