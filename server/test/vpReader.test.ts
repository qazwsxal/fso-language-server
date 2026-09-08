import { test } from "node:test";
import * as assert from "node:assert/strict";
import { decompressLz41 } from "../src/vp/reader";

/**
 * Builds a synthetic LZ41-framed entry payload matching the real trailer layout in
 * `code/cfile/cfilecompression.cpp` (see decompressLz41()'s doc comment): magic, then
 * `blocks` (each a raw LZ4 block byte sequence, back to back), then the offsets table
 * (one entry per block plus a trailing sentinel = block-region end), then
 * num_offsets/original_size/block_size.
 */
function buildLz41(blocks: Buffer[], originalSize: number, blockSize = 65536): Buffer {
  const header = Buffer.from("LZ41", "ascii");
  const offsets: number[] = [];
  let pos = header.length;
  for (const block of blocks) {
    offsets.push(pos);
    pos += block.length;
  }
  offsets.push(pos); // sentinel: start of trailer

  const offsetsBuf = Buffer.alloc(offsets.length * 4);
  offsets.forEach((o, i) => offsetsBuf.writeInt32LE(o, i * 4));

  const counts = Buffer.alloc(12);
  counts.writeInt32LE(offsets.length, 0); // num_offsets
  counts.writeInt32LE(originalSize, 4); // original_size
  counts.writeInt32LE(blockSize, 8); // block_size

  return Buffer.concat([header, ...blocks, offsetsBuf, counts]);
}

test("decompresses a single-block, literals-only LZ4 block (no trailing match)", () => {
  const literal = Buffer.from("hello world", "ascii");
  // token: literal-length nibble = 11, match-length nibble = 0 (no match follows).
  const block = Buffer.concat([Buffer.from([literal.length << 4]), literal]);

  const entry = buildLz41([block], literal.length);
  const result = decompressLz41(entry);

  assert.equal(result.toString("ascii"), "hello world");
});

test("resolves a match back-reference that spans a block boundary (streaming/linked decode)", () => {
  // Block 1: 4 literal bytes "AAAA", no match.
  const block1 = Buffer.concat([Buffer.from([4 << 4]), Buffer.from("AAAA", "ascii")]);
  // Block 2: no literals, one match copying 4 bytes ("AAAA") from 4 bytes back - i.e.
  // entirely out of block 1's already-decoded output, not block 2's own.
  const matchOffset = Buffer.alloc(2);
  matchOffset.writeUInt16LE(4, 0);
  const block2 = Buffer.concat([Buffer.from([0x00]), matchOffset]); // literalLen=0, matchLen field=0 -> +4 = 4

  const entry = buildLz41([block1, block2], 8);
  const result = decompressLz41(entry);

  assert.equal(result.toString("ascii"), "AAAAAAAA");
});

test("decodes extended (>=15) literal and match lengths via the 255-continuation byte", () => {
  // 20 literal bytes needs the extended-length encoding: nibble=15, then (20-15)=5.
  const literal = Buffer.from("abcdefghijklmnopqrst", "ascii"); // 20 bytes
  assert.equal(literal.length, 20);
  const block1 = Buffer.concat([Buffer.from([(15 << 4) | 0, 5]), literal]);

  // Block 2: match of length 300 copying the first byte of block1's literal ('a') 300
  // times - i.e. offset = current distance back to that single 'a'. Extended match
  // length encoding: nibble=15, then continuation bytes summing to 300-4-15=281, using
  // one 255 byte plus a 26 remainder (255+26=281).
  const offsetBuf = Buffer.alloc(2);
  offsetBuf.writeUInt16LE(20, 0); // 'a' is 20 bytes before the start of block 2's output
  const block2 = Buffer.concat([Buffer.from([0x0f]), offsetBuf, Buffer.from([255, 26])]);

  const entry = buildLz41([block1, block2], literal.length + 300);
  const result = decompressLz41(entry);

  assert.equal(result.length, 320);
  assert.equal(result.toString("ascii", 0, 20), literal.toString("ascii"));
  // Overlapping copy (offset 20 < length 300): the source pointer walks into bytes this
  // same match already wrote, so the 20-byte pattern cycles rather than degenerating to
  // a single repeated byte - the standard LZ4 "overlap" trick used for RLE-like runs.
  assert.equal(result.toString("ascii", 20), literal.toString("ascii").repeat(15));
});
