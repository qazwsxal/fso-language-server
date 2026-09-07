import { test } from "node:test";
import * as assert from "node:assert/strict";
import { decodeSubmodelGeometry } from "../src/pof/geometry";

const OP_EOF = 0;
const OP_DEFPOINTS = 1;
const OP_TMAPPOLY = 3;

/**
 * Builds a synthetic BSP polygon blob by hand, byte-for-byte matching the layout
 * transcribed from FSO's modelread.cpp (see pof/geometry.ts's header comment for the
 * exact source functions/offsets). This is deliberately NOT round-tripped through the
 * real FSO engine (no real .pof with known-good geometry was available in this
 * session) - it verifies the decoder's byte-layout understanding is *internally
 * consistent* and matches the transcribed offsets, not that it matches real FSO
 * engine output pixel-for-pixel. See client/test/fixtures/mymod/data/models/ for a
 * fixture POF built the same way, exercised end-to-end via the LSP request handler.
 *
 * Scenario: one DEFPOINTS block with 4 vertices forming a unit square in the XY plane,
 * where vertex 0 deliberately has TWO normals (to verify the decoder's normal-buffer
 * indexing correctly flattens per-vertex normal counts rather than assuming one normal
 * per vertex), followed by one TMAPPOLY quad face that fans into 2 triangles.
 */
function buildSyntheticBspData(): Buffer {
  const parts: Buffer[] = [];

  // ---- DEFPOINTS ----
  const nverts = 4;
  const normCounts = [2, 1, 1, 1]; // vertex 0 has 2 normals; the rest have 1 each
  const positions: [number, number, number][] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ];
  // Flattened normal buffer, in vertex-then-per-vertex-normal order:
  // index 0 = vertex0's 1st normal, 1 = vertex0's 2nd normal, 2 = vertex1's normal,
  // 3 = vertex2's normal, 4 = vertex3's normal.
  const normalBuffer: [number, number, number][] = [
    [0, 0, 1], // vertex0 normal A (unused by the face below, to prove it's skippable)
    [0, 0, -1], // vertex0 normal B (this is the one the face actually references)
    [0, 0, 1], // vertex1 normal
    [0, 0, 1], // vertex2 normal
    [0, 0, 1], // vertex3 normal
  ];

  const dataOffset = 20 + nverts; // header(8) + nverts(4) + n_norms(4) + offset(4) + normCounts(nverts)
  const defpointsHeaderAndCounts = Buffer.alloc(dataOffset);
  defpointsHeaderAndCounts.writeInt32LE(OP_DEFPOINTS, 0);
  // size filled in below once we know the total node length
  defpointsHeaderAndCounts.writeInt32LE(nverts, 8);
  defpointsHeaderAndCounts.writeInt32LE(normalBuffer.length, 12);
  defpointsHeaderAndCounts.writeInt32LE(dataOffset, 16);
  for (let i = 0; i < nverts; i++) {
    defpointsHeaderAndCounts.writeUInt8(normCounts[i], 20 + i);
  }

  const vertexBlockParts: Buffer[] = [];
  let normalCursor = 0;
  for (let i = 0; i < nverts; i++) {
    const posBuf = Buffer.alloc(12);
    posBuf.writeFloatLE(positions[i][0], 0);
    posBuf.writeFloatLE(positions[i][1], 4);
    posBuf.writeFloatLE(positions[i][2], 8);
    vertexBlockParts.push(posBuf);
    for (let k = 0; k < normCounts[i]; k++) {
      const n = normalBuffer[normalCursor++];
      const nBuf = Buffer.alloc(12);
      nBuf.writeFloatLE(n[0], 0);
      nBuf.writeFloatLE(n[1], 4);
      nBuf.writeFloatLE(n[2], 8);
      vertexBlockParts.push(nBuf);
    }
  }
  const vertexBlock = Buffer.concat(vertexBlockParts);
  const defpointsSize = dataOffset + vertexBlock.length;
  defpointsHeaderAndCounts.writeInt32LE(defpointsSize, 4);
  parts.push(Buffer.concat([defpointsHeaderAndCounts, vertexBlock]));

  // ---- TMAPPOLY (quad: vertnum 0..3, normnum chosen to reference specific global indices) ----
  const faceVertnums = [0, 1, 2, 3];
  const faceNormnums = [1, 2, 3, 4]; // vertex0 -> its SECOND normal (global index 1)
  const faceUVs: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const tmapVertsBuf = Buffer.alloc(faceVertnums.length * 12);
  for (let i = 0; i < faceVertnums.length; i++) {
    const off = i * 12;
    tmapVertsBuf.writeUInt16LE(faceVertnums[i], off);
    tmapVertsBuf.writeUInt16LE(faceNormnums[i], off + 2);
    tmapVertsBuf.writeFloatLE(faceUVs[i][0], off + 4);
    tmapVertsBuf.writeFloatLE(faceUVs[i][1], off + 8);
  }
  const tmapHeader = Buffer.alloc(44); // up through TMAP_VERTS offset
  const tmapSize = 44 + tmapVertsBuf.length;
  tmapHeader.writeInt32LE(OP_TMAPPOLY, 0);
  tmapHeader.writeInt32LE(tmapSize, 4);
  // normal (8..20), center (20..32), radius (32..36) are left zeroed - not used by the decoder
  tmapHeader.writeUInt32LE(faceVertnums.length, 36); // nv
  tmapHeader.writeInt32LE(0, 40); // tmap_num
  parts.push(Buffer.concat([tmapHeader, tmapVertsBuf]));

  // ---- EOF ----
  const eof = Buffer.alloc(8);
  eof.writeInt32LE(OP_EOF, 0);
  eof.writeInt32LE(8, 4);
  parts.push(eof);

  return Buffer.concat(parts);
}

test("decodeSubmodelGeometry fan-triangulates a quad and resolves per-vertex normals via the flattened normal buffer", () => {
  const bspData = buildSyntheticBspData();
  const geo = decodeSubmodelGeometry(bspData);

  assert.equal(geo.triangleCount, 2, "a 4-vertex face should fan-triangulate into 2 triangles");
  assert.equal(geo.positions.length, 18, "6 corners * 3 = 18 flat position numbers");
  assert.equal(geo.normals.length, 18);
  assert.equal(geo.uvs.length, 12, "6 corners * 2 = 12 flat uv numbers");
  assert.equal(geo.indices.length, 6);
  assert.deepEqual(geo.indices, [0, 1, 2, 3, 4, 5]);

  // Triangle fan from a quad [v0,v1,v2,v3] is (v0,v1,v2), (v0,v2,v3).
  const corner = (i: number) => ({
    pos: geo.positions.slice(i * 3, i * 3 + 3),
    normal: geo.normals.slice(i * 3, i * 3 + 3),
    uv: geo.uvs.slice(i * 2, i * 2 + 2),
  });

  // Corner 0 = v0: position (0,0,0), and normal must be vertex0's SECOND normal
  // (0,0,-1) - the global normnum (1) skips past vertex0's first normal, proving the
  // decoder flattens per-vertex normal counts rather than assuming 1 normal/vertex.
  const c0 = corner(0);
  assert.deepEqual(c0.pos, [0, 0, 0]);
  assert.deepEqual(c0.normal, [0, 0, -1]);
  assert.deepEqual(c0.uv, [0, 0]);

  // Corner 1 = v1: position (1,0,0), normal (0,0,1) (global index 2).
  const c1 = corner(1);
  assert.deepEqual(c1.pos, [1, 0, 0]);
  assert.deepEqual(c1.normal, [0, 0, 1]);

  // Corner 2 = v2: position (1,1,0).
  const c2 = corner(2);
  assert.deepEqual(c2.pos, [1, 1, 0]);

  // Second triangle starts again at v0, then v2, then v3.
  const c3 = corner(3);
  assert.deepEqual(c3.pos, [0, 0, 0]);
  const c4 = corner(4);
  assert.deepEqual(c4.pos, [1, 1, 0]);
  const c5 = corner(5);
  assert.deepEqual(c5.pos, [0, 1, 0]);
});

test("decodeSubmodelGeometry degrades to an empty mesh (never throws) on malformed input", () => {
  assert.deepEqual(decodeSubmodelGeometry(null), { positions: [], normals: [], uvs: [], indices: [], triangleCount: 0 });
  assert.deepEqual(decodeSubmodelGeometry(Buffer.alloc(0)), {
    positions: [],
    normals: [],
    uvs: [],
    indices: [],
    triangleCount: 0,
  });

  // Truncated/garbage buffer: a DEFPOINTS header claiming far more verts than the
  // buffer could possibly hold.
  const garbage = Buffer.alloc(24);
  garbage.writeInt32LE(OP_DEFPOINTS, 0);
  garbage.writeInt32LE(9999, 4);
  garbage.writeInt32LE(999999, 8); // absurd nverts
  assert.doesNotThrow(() => decodeSubmodelGeometry(garbage));
  const result = decodeSubmodelGeometry(garbage);
  assert.equal(result.triangleCount, 0);
});

test("decodeSubmodelGeometry fan-triangulates a triangle (n=3) as a single triangle with no extra corners", () => {
  // A minimal DEFPOINTS (3 verts, 1 normal each) + a 3-vertex TMAPPOLY + EOF.
  const nverts = 3;
  const dataOffset = 20 + nverts;
  const header = Buffer.alloc(dataOffset);
  header.writeInt32LE(OP_DEFPOINTS, 0);
  header.writeInt32LE(nverts, 8);
  header.writeInt32LE(nverts, 12);
  header.writeInt32LE(dataOffset, 16);
  for (let i = 0; i < nverts; i++) header.writeUInt8(1, 20 + i);

  const verts: [number, number, number][] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ];
  const vertexBlockParts: Buffer[] = [];
  for (const v of verts) {
    const posBuf = Buffer.alloc(12);
    posBuf.writeFloatLE(v[0], 0);
    posBuf.writeFloatLE(v[1], 4);
    posBuf.writeFloatLE(v[2], 8);
    vertexBlockParts.push(posBuf);
    const nBuf = Buffer.alloc(12);
    nBuf.writeFloatLE(0, 0);
    nBuf.writeFloatLE(0, 4);
    nBuf.writeFloatLE(1, 8);
    vertexBlockParts.push(nBuf);
  }
  const vertexBlock = Buffer.concat(vertexBlockParts);
  header.writeInt32LE(dataOffset + vertexBlock.length, 4);
  const defpoints = Buffer.concat([header, vertexBlock]);

  const tmapVertsBuf = Buffer.alloc(3 * 12);
  for (let i = 0; i < 3; i++) {
    tmapVertsBuf.writeUInt16LE(i, i * 12);
    tmapVertsBuf.writeUInt16LE(i, i * 12 + 2);
    tmapVertsBuf.writeFloatLE(0, i * 12 + 4);
    tmapVertsBuf.writeFloatLE(0, i * 12 + 8);
  }
  const tmapHeader = Buffer.alloc(44);
  tmapHeader.writeInt32LE(OP_TMAPPOLY, 0);
  tmapHeader.writeInt32LE(44 + tmapVertsBuf.length, 4);
  tmapHeader.writeUInt32LE(3, 36);
  const tmap = Buffer.concat([tmapHeader, tmapVertsBuf]);

  const eof = Buffer.alloc(8);
  eof.writeInt32LE(OP_EOF, 0);
  eof.writeInt32LE(8, 4);

  const bspData = Buffer.concat([defpoints, tmap, eof]);
  const geo = decodeSubmodelGeometry(bspData);
  assert.equal(geo.triangleCount, 1);
  assert.equal(geo.positions.length, 9);
});
