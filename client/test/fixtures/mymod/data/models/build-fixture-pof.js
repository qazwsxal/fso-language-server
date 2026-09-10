#!/usr/bin/env node
/**
 * Regenerates fighter01.pof, the test fixture used by client/test/suite/extension.test.ts
 * (and, for one subobject, by end-to-end 3D-viewer tests). Run with:
 *   node build-fixture-pof.js
 * from this directory (writes fighter01.pof next to this script).
 *
 * Layout constants transcribed from FSO's code/model/modelread.cpp (ID_OBJ2 case) and
 * code/model/model.h (TMAP_VERTS etc.) - see server/src/pof/geometry.ts's header
 * comment for the fuller citation. Kept deliberately simple: this is a hand-built
 * synthetic fixture, not extracted from a real game asset.
 *
 * Subobjects:
 *  0 "detail0"  - root hull, no geometry (bsp_data_size 0)
 *  1 "engine01" - child of detail0, no geometry (existing tests only check name
 *                 matching/hover text, not rendering, for this one)
 *  2 "turret01" - child of detail0, REAL geometry: a single textured quad face (unit
 *                 square in the XY plane) that decodes to 2 triangles - this is the
 *                 one exercised by the 3D-viewer / go-to-definition tests.
 *
 * Plus one SPCL "special point" named "$comm" - a non-geometric marker (position +
 * radius, no submodel of its own), the kind engine/weapons/communication/sensors/
 * navigation subsystems actually resolve against (see normalizeSpecialPointName() in
 * server/src/server.ts). Used by the ships.tbl fixture's "GTF Ulysses" $Subsystem: comm.
 *
 * Must stay consistent with client/test/fixtures/mymod/data/tables/ships.tbl:
 *  - $Subsystem: engine01 / turret01 must match subobject names here.
 *  - $Subsystem: comm must match the SPCL special point's name (minus its "$") here.
 *  - $Default PBanks: declares 1 bank but GPNT below declares 2 - existing test
 *    "flags a $Default PBanks: count mismatch" depends on that mismatch.
 */
const fs = require("fs");
const path = require("path");

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}
function i32(n) {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n, 0);
  return b;
}
function f32(n) {
  const b = Buffer.alloc(4);
  b.writeFloatLE(n, 0);
  return b;
}
function vec3(x, y, z) {
  return Buffer.concat([f32(x), f32(y), f32(z)]);
}
/** Length-prefixed, NUL-terminated POF string. */
function pofString(s) {
  const bytes = Buffer.from(s + "\0", "utf8");
  return Buffer.concat([i32(bytes.length), bytes]);
}
function chunk(id, data) {
  if (id.length !== 4) throw new Error(`chunk id must be 4 chars: "${id}"`);
  return Buffer.concat([Buffer.from(id, "ascii"), i32(data.length), data]);
}

// ---------- BSP geometry for turret01 (see server/test/geometry.test.ts for the same
// layout, verified there against the decoder) ----------
function buildQuadBspData() {
  const OP_EOF = 0;
  const OP_DEFPOINTS = 1;
  const OP_TMAPPOLY = 3;

  const nverts = 4;
  const normCounts = [1, 1, 1, 1];
  const positions = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ];
  const normals = [
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
  ];

  const dataOffset = 20 + nverts;
  const header = Buffer.alloc(dataOffset);
  header.writeInt32LE(OP_DEFPOINTS, 0);
  header.writeInt32LE(nverts, 8);
  header.writeInt32LE(normals.length, 12);
  header.writeInt32LE(dataOffset, 16);
  for (let i = 0; i < nverts; i++) header.writeUInt8(normCounts[i], 20 + i);

  const vertexParts = [];
  for (let i = 0; i < nverts; i++) {
    vertexParts.push(vec3(...positions[i]));
    vertexParts.push(vec3(...normals[i]));
  }
  const vertexBlock = Buffer.concat(vertexParts);
  header.writeInt32LE(dataOffset + vertexBlock.length, 4);
  const defpoints = Buffer.concat([header, vertexBlock]);

  const uvs = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const tmapVerts = Buffer.alloc(4 * 12);
  for (let i = 0; i < 4; i++) {
    const off = i * 12;
    tmapVerts.writeUInt16LE(i, off); // vertnum
    tmapVerts.writeUInt16LE(i, off + 2); // normnum
    tmapVerts.writeFloatLE(uvs[i][0], off + 4);
    tmapVerts.writeFloatLE(uvs[i][1], off + 8);
  }
  const tmapHeader = Buffer.alloc(44);
  tmapHeader.writeInt32LE(OP_TMAPPOLY, 0);
  tmapHeader.writeInt32LE(44 + tmapVerts.length, 4);
  tmapHeader.writeUInt32LE(4, 36); // nv
  tmapHeader.writeInt32LE(0, 40); // tmap_num
  const tmap = Buffer.concat([tmapHeader, tmapVerts]);

  const eof = Buffer.alloc(8);
  eof.writeInt32LE(OP_EOF, 0);
  eof.writeInt32LE(8, 4);

  return Buffer.concat([defpoints, tmap, eof]);
}

/**
 * Builds an OBJ2 (POF v21.16+) subobject chunk body. Field order verified against
 * modelread.cpp's ID_OBJ2 branch: submodel_number, radius, parent, offset,
 * geometric_center, bbox min/max, name, properties, rotation_type/axis_id, nchunks,
 * bsp_data_size, bsp_data. `bspData` may be an empty Buffer (bsp_data_size 0).
 */
function buildObj2(submodelNumber, parent, offset, name, bspData) {
  return Buffer.concat([
    i32(submodelNumber),
    f32(1.0), // radius
    i32(parent),
    offset, // vec3 offset from parent
    offset, // geometric center (reuse offset for simplicity - fine for a synthetic fixture)
    vec3(-0.5, -0.5, -0.5), // bbox min (relative to this submodel's own origin)
    vec3(0.5, 0.5, 0.5), // bbox max
    pofString(name),
    pofString(""), // properties
    i32(0), // rotation_type
    i32(0), // rotation_axis_id
    i32(0), // nchunks (must be 0 - unchunked)
    i32(bspData.length), // bsp_data_size
    bspData,
  ]);
}

const version = 2117; // v21.17 (< v23.01, so no translation_type/axis fields)

const header = Buffer.concat([Buffer.from("PSPO", "ascii"), i32(version)]);

const txtr = chunk("TXTR", Buffer.concat([i32(1), pofString("texture01")]));

const detail0 = chunk("OBJ2", buildObj2(0, -1, vec3(0, 0, 0), "detail0", Buffer.alloc(0)));
const engine01 = chunk("OBJ2", buildObj2(1, 0, vec3(0, 0, -5), "engine01", Buffer.alloc(0)));
const turret01 = chunk("OBJ2", buildObj2(2, 0, vec3(2, 0, 0), "turret01", buildQuadBspData()));

const gpnt = chunk("GPNT", i32(2)); // primary bank count = 2 (ships.tbl fixture deliberately declares 1, to exercise the mismatch diagnostic)
const mpnt = chunk("MPNT", i32(0)); // secondary bank count = 0

// One SPCL special point: name (with its conventional leading "$"), properties, position, radius.
const spcl = chunk(
  "SPCL",
  Buffer.concat([i32(1), pofString("$comm"), pofString(""), vec3(0, 0, 3), f32(0.5)]),
);

const pof = Buffer.concat([header, txtr, detail0, engine01, turret01, gpnt, mpnt, spcl]);

const outPath = path.join(__dirname, "fighter01.pof");
fs.writeFileSync(outPath, pof);
console.log(`Wrote ${outPath} (${pof.length} bytes)`);
