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

/**
 * Reads one entry's file data out of the archive, transparently LZ41-decompressing it
 * if it's stored that way (see decompressLz41()). The magic-byte check mirrors FSO's own
 * `comp_check_header()` - decompression is entirely payload-driven, not gated on the
 * `.vp`/`.vpc` filename convention.
 */
export function readVpEntry(vpPath: string, entry: VpEntry): Buffer {
  const fd = fs.openSync(vpPath, "r");
  try {
    const buf = Buffer.alloc(entry.size);
    fs.readSync(fd, buf, 0, entry.size, entry.offset);
    if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "LZ41") {
      return decompressLz41(buf);
    }
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Decompresses one LZ41-framed entry payload, per `code/cfile/cfilecompression.cpp`
 * (`lz41_create_ci`/`lz41_load_offsets`/`lz41_stream_random_access` - read directly from
 * a local fs2open.github.com checkout to ground-truth this, see vp-container-format
 * project memory) rather than the wiki's higher-level description alone.
 *
 * Trailer layout (last `12 + 4*num_offsets` bytes of `compressed`), confirmed by reading
 * backward from the end via `fso_fseek(..., SEEK_END)` in the C++ source:
 *   [... N compressed blocks ...][num_offsets x int32 offsets][num_offsets: int32][original_size: int32][block_size: int32]
 * `offsets[i]` is a byte position measured from the start of `compressed` (i.e. from the
 * "LZ41" magic, matching `fso_fseek`'s `offset + lib_offset`). There are `num_offsets`
 * entries but only `num_offsets - 1` real blocks - the last offset is a sentinel marking
 * where the trailer begins, used only to compute the final block's compressed length.
 *
 * The real decoder uses one `LZ4_streamDecode_t` context across every block in a read
 * (an LZ4 "linked blocks" / ring-buffer decode, where later blocks' matches can reference
 * earlier blocks' already-decoded output as an implicit dictionary) rather than resetting
 * per block. Decoding sequentially into one contiguous, monotonically-growing output
 * buffer reproduces that exactly: an LZ4 back-reference is just "copy `matchLength` bytes
 * starting `offset` bytes before the current write position," and that's valid however
 * far back it points, including into a prior block, as long as the buffer never shrinks
 * or moves - which a plain growing Buffer satisfies for free.
 */
export function decompressLz41(compressed: Buffer): Buffer {
  const end = compressed.length;
  const numOffsets = compressed.readInt32LE(end - 12);
  const originalSize = compressed.readInt32LE(end - 8);
  // block_size (compressed.readInt32LE(end - 4)) isn't needed for decoding itself -
  // each block's own compressed length (from consecutive offsets) is enough to bound
  // the LZ4 decoder, and originalSize bounds the output buffer.
  if (numOffsets < 2) {
    throw new Error(`LZ41 entry has invalid offset count (${numOffsets})`);
  }

  const offsetsStart = end - 12 - 4 * numOffsets;
  const offsets: number[] = [];
  for (let i = 0; i < numOffsets; i++) {
    offsets.push(compressed.readInt32LE(offsetsStart + i * 4));
  }

  const output = Buffer.alloc(originalSize);
  let written = 0;
  const blockCount = numOffsets - 1;
  for (let block = 0; block < blockCount; block++) {
    const blockStart = offsets[block];
    const blockEnd = offsets[block + 1];
    written += lz4DecompressBlock(compressed, blockStart, blockEnd, output, written);
  }
  return output;
}

/**
 * Decompresses one raw LZ4 block (no frame header - just the token/literal/match
 * sequence stream, per the standard LZ4 block format) from `input[inStart, inEnd)` into
 * `output` starting at `outStart`, returning the number of bytes written. Matches are
 * resolved against `output` itself, so a match offset can legally reach earlier than
 * `outStart` (into a previously-decoded block) - see decompressLz41()'s doc comment.
 */
function lz4DecompressBlock(input: Buffer, inStart: number, inEnd: number, output: Buffer, outStart: number): number {
  let ip = inStart;
  let op = outStart;

  while (ip < inEnd) {
    const token = input[ip++];

    let literalLength = token >> 4;
    if (literalLength === 15) {
      let b: number;
      do {
        b = input[ip++];
        literalLength += b;
      } while (b === 255);
    }
    input.copy(output, op, ip, ip + literalLength);
    ip += literalLength;
    op += literalLength;

    // The final sequence in a block may be literals-only, with no trailing match.
    if (ip >= inEnd) {
      break;
    }

    const matchOffset = input.readUInt16LE(ip);
    ip += 2;

    let matchLength = token & 0x0f;
    if (matchLength === 15) {
      let b: number;
      do {
        b = input[ip++];
        matchLength += b;
      } while (b === 255);
    }
    matchLength += 4; // LZ4's minimum match length

    const matchStart = op - matchOffset;
    for (let i = 0; i < matchLength; i++) {
      output[op + i] = output[matchStart + i];
    }
    op += matchLength;
  }

  return op - outStart;
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
