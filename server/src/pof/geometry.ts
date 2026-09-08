/**
 * Decodes a POF submodel's raw BSP polygon-tree blob (`PofSubobject.bspData`, captured
 * but left un-decoded by pof/reader.ts) into a flat, renderer-ready triangle mesh.
 *
 * Source of truth: FSO's code/model/modelread.cpp, specifically the swap_bsp_*()
 * family of functions (swap_bsp_defpoints, swap_bsp_flatpoly, swap_bsp_tmappoly,
 * swap_bsp_tmap2poly, swap_bsp_sortnorm, swap_bsp_sortnorm2, and the main
 * swap_bsp_data() dispatch loop) plus the TMAP_VERTS/TMAP2_* byte-offset constants and
 * opcode numbers (OP_EOF=0, OP_DEFPOINTS=1, OP_FLATPOLY=2, OP_TMAPPOLY=3,
 * OP_SORTNORM=4, OP_BOUNDBOX=5, OP_TMAP2POLY=6, OP_SORTNORM2=7) from code/model/model.h
 * and code/model/modelsinc.h. Those swap_bsp_* functions only exist to byte-swap
 * fields in place for big-endian platforms, but doing so requires them to know every
 * field's exact offset/type - which is exactly the information this decoder needs, and
 * the most precise documentation of the BSP block layout available anywhere in the FSO
 * source tree. Every byte offset below is transcribed from that source, not guessed.
 *
 * One thing that is NOT spelled out anywhere in modelread.cpp: what "index into a
 * subobject normal buffer" (the doc-comment on model_tmap_vert::normnum) actually means
 * as a concrete index. This decoder's reading - confirmed to at least be *consistent*
 * (round-trips correctly against a hand-built synthetic fixture, see
 * geometry.test.ts) - is that OP_DEFPOINTS stores, for each vertex in order, that
 * vertex's position immediately followed by its own normcount[i] normals, and that
 * normnum is a flat index into the concatenation of ALL vertices' normal lists in that
 * same storage order (i.e. normal buffer index N is the N-th vec3d encountered while
 * walking the defpoints vertex data left to right, positions excluded). This is the
 * most natural reading of the contiguous storage layout, but is flagged here as an
 * inference, not a transcribed certainty - a real POF with per-vertex hard-edge normals
 * would be a good target to double check this against if one turns up.
 *
 * Defensive by design, matching this project's established parsing style
 * (binaryReader.ts's readString(), reader.ts's per-chunk try/catch): any malformed or
 * unexpected byte layout degrades to an empty mesh for that submodel rather than
 * throwing, so one bad/unusual submodel never prevents the rest of a model (or the
 * rest of this submodel's already-decoded siblings) from rendering.
 */

const OP_EOF = 0;
const OP_DEFPOINTS = 1;
const OP_FLATPOLY = 2;
const OP_TMAPPOLY = 3;
const OP_SORTNORM = 4;
const OP_BOUNDBOX = 5;
const OP_TMAP2POLY = 6;
const OP_SORTNORM2 = 7;

// TMAPPOLY vertex array start (model.h: TMAP_VERTS).
const TMAP_VERTS = 44;
// TMAP2POLY field offsets (model.h: TMAP2_TEXNUM/TMAP2_NVERTS/TMAP2_VERTS).
const TMAP2_TEXNUM = 44;
const TMAP2_NVERTS = 48;
const TMAP2_VERTS = 52;

/** One decoded triangle-corner instance: a vertex is emitted once per triangle corner that uses it (a POF vertex can carry a different normal per adjacent face), so positions/normals/uvs are all the same length and `indices` is a trivial 0..n-1 sequence - included so callers always get an index buffer. */
export interface SubmodelGeometry {
  /** Flat xyz triples, one per triangle-corner instance. */
  positions: number[];
  /** Flat xyz triples, one per triangle-corner instance (same length as positions). */
  normals: number[];
  /** Flat uv pairs, one per triangle-corner instance ([0,0] for untextured/FLATPOLY faces). */
  uvs: number[];
  /** Trivial 0..n-1 triangle index list (length = positions.length / 3). */
  indices: number[];
  triangleCount: number;
}

interface VertexSource {
  /** Flat xyz triples, indexed by vertnum. */
  positions: number[];
  vertexCount: number;
  /** Flat xyz triples, indexed by normnum (see the class-level doc comment on how normnum is inferred). */
  normals: number[];
}

interface Corner {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  u: number;
  v: number;
}

function emptyGeometry(): SubmodelGeometry {
  return { positions: [], normals: [], uvs: [], indices: [], triangleCount: 0 };
}

/** Decodes one submodel's BSP polygon blob into a flat triangle mesh. Never throws - returns an empty mesh on any unexpected/malformed data. */
export function decodeSubmodelGeometry(bspData: Buffer | null | undefined): SubmodelGeometry {
  if (!bspData || bspData.length < 8) {
    return emptyGeometry();
  }

  try {
    let vertexSource: VertexSource | null = null;
    const corners: Corner[] = [];

    const resolveVertex = (vertnum: number, normnum: number): Corner | null => {
      if (!vertexSource || vertnum < 0 || vertnum >= vertexSource.vertexCount) {
        return null;
      }
      const px = vertexSource.positions[vertnum * 3];
      const py = vertexSource.positions[vertnum * 3 + 1];
      const pz = vertexSource.positions[vertnum * 3 + 2];
      const normalCount = vertexSource.normals.length / 3;
      let nx = 0;
      let ny = 0;
      let nz = 1;
      if (normnum >= 0 && normnum < normalCount) {
        nx = vertexSource.normals[normnum * 3];
        ny = vertexSource.normals[normnum * 3 + 1];
        nz = vertexSource.normals[normnum * 3 + 2];
      }
      return { x: px, y: py, z: pz, nx, ny, nz, u: 0, v: 0 };
    };

    /** Fan-triangulates an n-gon (n>=3) face given its per-corner vertex/normal/uv lookups, appending resulting triangle corners to `corners`. */
    const emitFace = (faceVerts: { vertnum: number; normnum: number; u: number; v: number }[]) => {
      if (faceVerts.length < 3) {
        return;
      }
      const resolved: (Corner | null)[] = faceVerts.map((fv) => {
        const c = resolveVertex(fv.vertnum, fv.normnum);
        return c ? { ...c, u: fv.u, v: fv.v } : null;
      });
      if (resolved.some((c) => c === null)) {
        return; // a bad vertex/normal index anywhere in this face - skip the whole face defensively
      }
      const verts = resolved as Corner[];
      for (let i = 1; i < verts.length - 1; i++) {
        corners.push(verts[0], verts[i], verts[i + 1]);
      }
    };

    const parseDefpoints = (nodeStart: number): void => {
      const nverts = readInt32(bspData, nodeStart + 8);
      const nnorms = readInt32(bspData, nodeStart + 12);
      const dataOffset = readInt32(bspData, nodeStart + 16);
      if (nverts === null || nnorms === null || dataOffset === null || nverts < 0 || nverts > 200000) {
        return;
      }
      const normCountOffset = nodeStart + 20;
      if (normCountOffset + nverts > bspData.length) {
        return;
      }
      const positions: number[] = [];
      const normals: number[] = [];
      let cursor = nodeStart + dataOffset;
      for (let i = 0; i < nverts; i++) {
        const pos = readVec3(bspData, cursor);
        if (!pos) {
          return;
        }
        positions.push(pos[0], pos[1], pos[2]);
        cursor += 12;
        const normCount = bspData.readUInt8(normCountOffset + i);
        for (let k = 0; k < normCount; k++) {
          const n = readVec3(bspData, cursor);
          if (!n) {
            return;
          }
          normals.push(n[0], n[1], n[2]);
          cursor += 12;
        }
      }
      vertexSource = { positions, vertexCount: nverts, normals };
    };

    const parseFlatPoly = (nodeStart: number): void => {
      const nv = readUInt32(bspData, nodeStart + 36);
      if (nv === null || nv < 3 || nv > 100000) {
        return;
      }
      const vertsOffset = nodeStart + 44;
      const faceVerts: { vertnum: number; normnum: number; u: number; v: number }[] = [];
      for (let i = 0; i < nv; i++) {
        const off = vertsOffset + i * 4;
        const vertnum = readInt16(bspData, off);
        const normnum = readInt16(bspData, off + 2);
        if (vertnum === null || normnum === null) {
          return;
        }
        faceVerts.push({ vertnum, normnum, u: 0, v: 0 });
      }
      emitFace(faceVerts);
    };

    const parseTmapPoly = (nodeStart: number): void => {
      const nv = readUInt32(bspData, nodeStart + 36);
      if (nv === null || nv < 3 || nv > 100000) {
        return;
      }
      const vertsOffset = nodeStart + TMAP_VERTS;
      const faceVerts: { vertnum: number; normnum: number; u: number; v: number }[] = [];
      for (let i = 0; i < nv; i++) {
        const off = vertsOffset + i * 12; // model_tmap_vert_old: ushort+ushort+float+float = 12 bytes
        const vertnum = readUInt16(bspData, off);
        const normnum = readUInt16(bspData, off + 2);
        const u = readFloat(bspData, off + 4);
        const v = readFloat(bspData, off + 8);
        if (vertnum === null || normnum === null || u === null || v === null) {
          return;
        }
        faceVerts.push({ vertnum, normnum, u, v });
      }
      emitFace(faceVerts);
    };

    const parseTmap2Poly = (nodeStart: number): void => {
      const nv = readUInt32(bspData, nodeStart + TMAP2_NVERTS);
      if (nv === null || nv < 3 || nv > 100000) {
        return;
      }
      const vertsOffset = nodeStart + TMAP2_VERTS;
      const faceVerts: { vertnum: number; normnum: number; u: number; v: number }[] = [];
      for (let i = 0; i < nv; i++) {
        const off = vertsOffset + i * 16; // model_tmap_vert: uint+uint+float+float = 16 bytes
        const vertnum = readUInt32(bspData, off);
        const normnum = readUInt32(bspData, off + 4);
        const u = readFloat(bspData, off + 8);
        const v = readFloat(bspData, off + 12);
        if (vertnum === null || normnum === null || u === null || v === null) {
          return;
        }
        faceVerts.push({ vertnum, normnum, u, v });
      }
      emitFace(faceVerts);
    };

    let iterations = 0;
    const MAX_ITERATIONS = 500000;
    const MAX_DEPTH = 128;

    // Recursive-descent walk of a node LIST starting at `start` (the top-level bsp_data
    // is itself one such list). Each node's own declared `size` (chunk_size, at
    // offset+4) tells us where the NEXT sibling in this list begins - this holds even
    // for a branch node (OP_SORTNORM/OP_SORTNORM2), whose size spans its own header
    // AND its entire descendant subtree; the branch's front/back/pre/post/on fields are
    // separate *relative* offsets used only to descend INTO that subtree, mirroring
    // swap_bsp_data()'s dispatch + "p += chunk_size to reach whatever follows" loop.
    const walkList = (start: number, depth: number): void => {
      if (depth > MAX_DEPTH) {
        return;
      }
      let pos = start;
      for (;;) {
        if (iterations++ > MAX_ITERATIONS) {
          return;
        }
        if (pos < 0 || pos + 8 > bspData.length) {
          return;
        }
        const type = readInt32(bspData, pos);
        const size = readInt32(bspData, pos + 4);
        if (type === null || size === null || size <= 0) {
          return;
        }
        if (type === OP_EOF) {
          return;
        }
        switch (type) {
          case OP_DEFPOINTS:
            parseDefpoints(pos);
            break;
          case OP_FLATPOLY:
            parseFlatPoly(pos);
            break;
          case OP_TMAPPOLY:
            parseTmapPoly(pos);
            break;
          case OP_BOUNDBOX:
            break; // bounding box only - no geometry to extract
          case OP_SORTNORM: {
            const frontlist = readInt32(bspData, pos + 36);
            const backlist = readInt32(bspData, pos + 40);
            const prelist = readInt32(bspData, pos + 44);
            const postlist = readInt32(bspData, pos + 48);
            const onlist = readInt32(bspData, pos + 52);
            for (const rel of [prelist, backlist, onlist, frontlist, postlist]) {
              if (rel !== null && rel !== 0) {
                walkList(pos + rel, depth + 1);
              }
            }
            break;
          }
          case OP_SORTNORM2: {
            // modelread.cpp's swap_bsp_sortnorm2() is BIG_ENDIAN-only dead code and
            // misleadingly reads bmin/bmax starting at +8 (overlapping frontlist/
            // backlist) - but the code that actually WALKS this tree for real use
            // (modelinterp.cpp's submodel_get_num_polys_sub() and
            // modelcollide.cpp's model_collide_parse_bsp(), both confirmed from
            // source) agrees: frontlist is a real int at +8, backlist at +12, and
            // bmin/bmax vec3ds follow at +16/+28 - no overlap. Both of those real
            // walkers also confirm this opcode DOES recurse into front/back (unlike a
            // leaf), but - like OP_TMAP2POLY below - is terminal for the CURRENT list:
            // "should not continue after this chunk" in both source functions means
            // stop this list's own iteration, not "don't recurse".
            //
            // The original version of this decoder recursed into front/back correctly
            // but ALSO fell through to `pos += size` and kept iterating the current
            // list - so a node already fully covered by the explicit front/back
            // recursion got walked AGAIN via the outer list's own continuation. Every
            // level of a real (often deeply nested) BSP tree compounds this, and
            // against a real Blue Planet capital ship (UEFg_Karuna.pof) it inflated
            // every single submodel to ~200,000+ implausible triangles regardless of
            // its actual BSP data size - enough, across ~150 submodels, to OOM the LSP
            // server on a single F12/ctrl+click.
            const frontlist = readInt32(bspData, pos + 8);
            const backlist = readInt32(bspData, pos + 12);
            for (const rel of [frontlist, backlist]) {
              if (rel !== null && rel !== 0) {
                walkList(pos + rel, depth + 1);
              }
            }
            return;
          }
          case OP_TMAP2POLY:
            // Same "should not continue after this chunk" terminal behavior as
            // OP_SORTNORM2 above - confirmed in the same dispatcher function.
            parseTmap2Poly(pos);
            return;
          default:
            // Unknown opcode - stop this list defensively rather than risk misreading
            // `size` for a format we don't recognize.
            return;
        }
        pos += size;
      }
    };

    walkList(0, 0);

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    for (const c of corners) {
      positions.push(c.x, c.y, c.z);
      normals.push(c.nx, c.ny, c.nz);
      uvs.push(c.u, c.v);
    }
    const indices = corners.map((_, i) => i);

    return { positions, normals, uvs, indices, triangleCount: corners.length / 3 };
  } catch {
    return emptyGeometry();
  }
}

function readInt32(buf: Buffer, offset: number): number | null {
  if (offset < 0 || offset + 4 > buf.length) return null;
  return buf.readInt32LE(offset);
}
function readUInt32(buf: Buffer, offset: number): number | null {
  if (offset < 0 || offset + 4 > buf.length) return null;
  return buf.readUInt32LE(offset);
}
function readInt16(buf: Buffer, offset: number): number | null {
  if (offset < 0 || offset + 2 > buf.length) return null;
  return buf.readInt16LE(offset);
}
function readUInt16(buf: Buffer, offset: number): number | null {
  if (offset < 0 || offset + 2 > buf.length) return null;
  return buf.readUInt16LE(offset);
}
function readFloat(buf: Buffer, offset: number): number | null {
  if (offset < 0 || offset + 4 > buf.length) return null;
  return buf.readFloatLE(offset);
}
function readVec3(buf: Buffer, offset: number): [number, number, number] | null {
  const x = readFloat(buf, offset);
  const y = readFloat(buf, offset + 4);
  const z = readFloat(buf, offset + 8);
  if (x === null || y === null || z === null) return null;
  return [x, y, z];
}
