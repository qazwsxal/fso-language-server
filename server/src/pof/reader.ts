import { BinaryReader } from "./binaryReader";
import {
  PofModel,
  PofSubobject,
  PofDockPoint,
  PofPath,
  PofSpecialPoint,
  PofGlowBank,
  PofThrusterBank,
  PofEyePoint,
  PofTurretBank,
} from "./types";

const FILE_SIGNATURE = "PSPO";

/**
 * Parses a POF model file far enough to extract the named entities that FSO tables
 * reference (subsystem/submodel names, docking bay names, path names, glow/thruster
 * bank properties), plus a few more chunks useful for count/consistency validation
 * (gun/missile bank counts, turret bank subobject linkage, eye points, build info,
 * autocentering point, insignia count) — see the pof-file-format project memory.
 * Does NOT decode shield mesh, collision trees, or insignia mesh data - those chunks
 * are skipped wholesale via each chunk's declared `length`, which this reader always
 * trusts as the authority for where the next chunk starts, even when a per-chunk
 * field-layout guess below turns out wrong for a given POF version. Each SOBJ/OBJ2
 * subobject's BSP polygon blob (`bsp_data`) IS captured (as a zero-copy Buffer slice,
 * on `PofSubobject.bspData`) but NOT decoded here - see pof/geometry.ts for the actual
 * BSP-opcode walk that turns it into a renderable triangle mesh, kept separate so a
 * caller that only needs names/hierarchy (the bulk of this reader's callers) never pays
 * for geometry decoding.
 *
 * Field layouts for DOCK/PATH/GLOW/FUEL/SPCL/EYE/TGUN/TMIS are a best-effort
 * reconstruction from wiki documentation, not a transcription of FSO's modelread.cpp —
 * parsing is defensive (bounds-checked string reads that degrade to `null` rather than
 * throwing) so a wrong guess produces missing data for that one chunk instead of
 * corrupting the whole file. GPNT/MPNT are deliberately only read one int32 deep (bank
 * count) rather than walked per-bank/per-point, because the per-point layout has a
 * version-dependent optional trailing field with no safe way to detect its presence -
 * unlike a length-prefixed string, a wrong guess there has no rewind mechanism and would
 * silently misalign every bank after the first.
 */
export function parsePof(buffer: Buffer): PofModel {
  const reader = new BinaryReader(buffer);

  const model: PofModel = {
    version: 0,
    textures: [],
    subobjects: [],
    dockPoints: [],
    paths: [],
    specialPoints: [],
    glowBanks: [],
    thrusterBanks: [],
    buildInfo: null,
    eyePoints: [],
    primaryBankCount: null,
    secondaryBankCount: null,
    turretGunBanks: [],
    turretMissileBanks: [],
    autocenterPoint: null,
    insigniaCount: 0,
    detailLevelRootSubmodels: [],
    debrisSubmodels: [],
    unhandledChunkIds: [],
  };

  if (!reader.canRead(8)) {
    return model;
  }

  const signature = reader.readFixedChars(4);
  if (signature !== FILE_SIGNATURE) {
    return model;
  }
  model.version = reader.readInt32();

  const unhandled = new Set<string>();

  while (reader.canRead(8)) {
    const chunkId = reader.readFixedChars(4);
    const length = reader.readInt32();
    const chunkDataStart = reader.position;
    const chunkDataEnd = chunkDataStart + length;

    if (length < 0 || chunkDataEnd > buffer.length) {
      // Malformed/unexpected chunk length - stop rather than reading garbage indefinitely.
      break;
    }

    try {
      switch (chunkId) {
        case "TXTR":
          model.textures.push(...readTextures(reader, chunkDataEnd));
          break;
        case "SOBJ":
        case "OBJ2":
          model.subobjects.push(readSubobject(reader, chunkDataEnd, chunkId as "SOBJ" | "OBJ2", model.version));
          break;
        case "DOCK":
          model.dockPoints.push(...readDockPoints(reader, chunkDataEnd));
          break;
        case "PATH":
          model.paths.push(...readPaths(reader, chunkDataEnd));
          break;
        case "SPCL":
          model.specialPoints.push(...readSpecialPoints(reader, chunkDataEnd));
          break;
        case "GLOW":
          model.glowBanks.push(...readGlowBanks(reader, chunkDataEnd));
          break;
        case "FUEL":
          model.thrusterBanks.push(...readThrusterBanks(reader, chunkDataEnd));
          break;
        case "PINF":
          model.buildInfo = readBuildInfo(reader, chunkDataEnd);
          break;
        case "EYE ":
          model.eyePoints.push(...readEyePoints(reader, chunkDataEnd));
          break;
        case "GPNT":
          model.primaryBankCount = reader.readInt32();
          break;
        case "MPNT":
          model.secondaryBankCount = reader.readInt32();
          break;
        case "TGUN":
          model.turretGunBanks.push(...readTurretBanks(reader, chunkDataEnd));
          break;
        case "TMIS":
          model.turretMissileBanks.push(...readTurretBanks(reader, chunkDataEnd));
          break;
        case "ACEN":
          model.autocenterPoint = reader.readVector();
          break;
        case "INSG":
          model.insigniaCount = reader.readInt32();
          break;
        case "OHDR":
        case "HDR2": {
          const header = readHeader(reader, chunkId as "OHDR" | "HDR2");
          model.detailLevelRootSubmodels = header.detailLevelRootSubmodels;
          model.debrisSubmodels = header.debrisSubmodels;
          break;
        }
        default:
          unhandled.add(chunkId);
          break;
      }
    } catch {
      // A field-layout guess above didn't hold for this file/version - fall through to
      // the unconditional jump below and keep whatever partial data we already pushed.
    }

    reader.position = chunkDataEnd;
  }

  model.unhandledChunkIds = Array.from(unhandled);
  return model;
}

/**
 * Field order confirmed against FSO's modelread.cpp (ID_OHDR/ID_HDR2 case): the two
 * chunk IDs read the same three leading fields in a DIFFERENT order (OHDR:
 * n_models/rad/flags; HDR2: rad/flags/n_models) before converging on the same
 * mins/maxs vectors, `n_detail_levels` + that many detail-level root submodel indices,
 * then `num_debris_objects` + that many debris-piece submodel indices. Only the
 * detail-level/debris arrays are exposed on PofModel - everything else in this chunk
 * (radius, mass, moment of inertia, ...) isn't needed by any current feature.
 */
function readHeader(
  reader: BinaryReader,
  chunkId: "OHDR" | "HDR2",
): { detailLevelRootSubmodels: number[]; debrisSubmodels: number[] } {
  if (chunkId === "OHDR") {
    reader.skip(4); // n_models
    reader.skip(4); // rad
    reader.skip(4); // flags
  } else {
    reader.skip(4); // rad
    reader.skip(4); // flags
    reader.skip(4); // n_models
  }
  reader.skipVector(); // mins
  reader.skipVector(); // maxs

  const detailLevelRootSubmodels: number[] = [];
  const nDetailLevels = reader.readInt32();
  for (let i = 0; i < nDetailLevels && reader.canRead(4); i++) {
    detailLevelRootSubmodels.push(reader.readInt32());
  }

  const debrisSubmodels: number[] = [];
  const numDebrisObjects = reader.readInt32();
  for (let i = 0; i < numDebrisObjects && reader.canRead(4); i++) {
    debrisSubmodels.push(reader.readInt32());
  }

  return { detailLevelRootSubmodels, debrisSubmodels };
}

function readTextures(reader: BinaryReader, chunkEnd: number): string[] {
  const textures: string[] = [];
  const count = reader.readInt32();
  for (let i = 0; i < count && reader.position < chunkEnd; i++) {
    const name = reader.readString();
    textures.push(name ?? "");
  }
  return textures;
}

/**
 * Field order verified against FSO's code/model/modelread.cpp (ID_SOBJ/ID_OBJ2 case in
 * the model-loading loop): the two chunk IDs are NOT simply a name change - v21.16+
 * (ID_OBJ2, used by virtually every real FS2/FSO-era POF) reads `radius` immediately
 * after the submodel number and BEFORE `parent`/`offset`, whereas the older FS1-era
 * ID_SOBJ reads it AFTER `offset`. A previous version of this reader used the ID_SOBJ
 * order unconditionally, which silently misaligned every field after `parent` (parent
 * index, name, properties, and critically the BSP data offset needed for geometry
 * decoding) for any OBJ2 file - i.e. almost every real-world POF.
 */
function readSubobject(
  reader: BinaryReader,
  chunkEnd: number,
  chunkId: "SOBJ" | "OBJ2",
  version: number,
): PofSubobject {
  const submodelNumber = reader.readInt32();
  if (chunkId === "OBJ2") {
    reader.skip(4); // radius (not currently exposed on PofSubobject)
  }
  const parentSubmodel = reader.readInt32();
  const offset = reader.readVector();
  if (chunkId === "SOBJ") {
    reader.skip(4); // radius
  }
  reader.skipVector(); // geometric center
  reader.skipVector(); // bounding box min
  reader.skipVector(); // bounding box max
  const name = reader.position < chunkEnd ? reader.readString() : null;
  const properties = reader.position < chunkEnd ? reader.readString() : null;

  // ---------- submodel movement + BSP polygon data ----------
  // rotation_type, rotation_axis_id (always present); translation_type/axis_id were
  // added in POF v23.01+ (pm->version >= 2301 in modelread.cpp); then an `nchunks` int
  // that must be 0 for an unchunked model (anything else is a format this reader
  // doesn't understand); then `bsp_data_size` + that many raw bytes of BSP polygon
  // data. Every step here is guarded (bounds-checked, wrapped in try/catch) so a wrong
  // guess or truncated file degrades to "no geometry for this submodel" rather than
  // corrupting the rest of the parse - consistent with this reader's established style.
  let bspData: Buffer | null = null;
  try {
    reader.skip(4); // rotation_type
    reader.skip(4); // rotation_axis_id
    if (version >= 2301) {
      reader.skip(4); // translation_type
      reader.skip(4); // translation_axis_id
    }
    if (reader.canRead(4)) {
      const nchunks = reader.readInt32();
      if (nchunks === 0 && reader.canRead(4)) {
        const bspDataSize = reader.readInt32();
        if (bspDataSize > 0) {
          bspData = reader.readRawBytes(bspDataSize);
        }
      }
    }
  } catch {
    bspData = null;
  }

  return { submodelNumber, parentSubmodel, name, properties, offset, bspData };
}

function readDockPoints(reader: BinaryReader, chunkEnd: number): PofDockPoint[] {
  const points: PofDockPoint[] = [];
  const count = reader.readInt32();
  for (let i = 0; i < count && reader.position < chunkEnd; i++) {
    const properties = reader.readString();
    const numSplinePaths = reader.readInt32();
    for (let s = 0; s < numSplinePaths; s++) {
      reader.readInt32(); // spline path index (engine only uses the first; unused here)
    }
    const numPoints = reader.readInt32();
    for (let p = 0; p < numPoints; p++) {
      reader.skipVector(); // position
      reader.skipVector(); // normal
    }
    points.push({
      properties,
      name: extractPropertyValue(properties, "name"),
      isCargoBay: (properties ?? "").toLowerCase().includes("cargo"),
    });
  }
  return points;
}

function readPaths(reader: BinaryReader, chunkEnd: number): PofPath[] {
  const paths: PofPath[] = [];
  const count = reader.readInt32();
  for (let i = 0; i < count && reader.position < chunkEnd; i++) {
    const name = reader.readString();
    const parentName = reader.readString();
    const numVerts = reader.readInt32();
    for (let v = 0; v < numVerts; v++) {
      reader.skipVector(); // position
      reader.skip(4); // radius
      const numTurrets = reader.readInt32();
      for (let t = 0; t < numTurrets; t++) {
        reader.readInt32(); // turret subobject index (unused by the engine here)
      }
    }
    paths.push({ name, parentName });
  }
  return paths;
}

function readSpecialPoints(reader: BinaryReader, chunkEnd: number): PofSpecialPoint[] {
  const points: PofSpecialPoint[] = [];
  const count = reader.readInt32();
  for (let i = 0; i < count && reader.position < chunkEnd; i++) {
    const name = reader.readString();
    const properties = reader.readString();
    reader.skipVector(); // position
    reader.skip(4); // radius
    points.push({ name, properties });
  }
  return points;
}

function readGlowBanks(reader: BinaryReader, chunkEnd: number): PofGlowBank[] {
  const banks: PofGlowBank[] = [];
  const count = reader.readInt32();
  for (let i = 0; i < count && reader.position < chunkEnd; i++) {
    reader.readInt32(); // disp_time
    reader.readInt32(); // on_time
    reader.readInt32(); // off_time
    const parentSubobject = reader.readInt32();
    reader.readInt32(); // lod
    reader.readInt32(); // type
    const numPoints = reader.readInt32();
    const properties = reader.readString();
    for (let p = 0; p < numPoints; p++) {
      reader.skipVector(); // position
      reader.skipVector(); // normal
      reader.skip(4); // radius
    }
    banks.push({ properties, parentSubobject });
  }
  return banks;
}

function readThrusterBanks(reader: BinaryReader, chunkEnd: number): PofThrusterBank[] {
  const banks: PofThrusterBank[] = [];
  const count = reader.readInt32();
  for (let i = 0; i < count && reader.position < chunkEnd; i++) {
    const numPoints = reader.readInt32();
    // Properties string was added in POF v21.17+; older files won't have it here.
    // readString() rewinds cleanly if what follows isn't a plausible length-prefixed
    // string, so a pre-v21.17 FUEL chunk just yields properties: null here.
    const properties = reader.readString();
    for (let p = 0; p < numPoints; p++) {
      reader.skipVector(); // position
      reader.skipVector(); // normal
      reader.skip(4); // radius
    }
    banks.push({ properties });
  }
  return banks;
}

/** PINF is a free-form block, not a length-prefixed string like the others - just NUL-terminated raw text filling the whole chunk. */
function readBuildInfo(reader: BinaryReader, chunkEnd: number): string | null {
  const length = chunkEnd - reader.position;
  if (length <= 0 || !reader.canRead(length)) {
    return null;
  }
  const raw = reader.readFixedChars(length);
  const nulIdx = raw.indexOf("\0");
  return nulIdx === -1 ? raw : raw.slice(0, nulIdx);
}

function readEyePoints(reader: BinaryReader, chunkEnd: number): PofEyePoint[] {
  const points: PofEyePoint[] = [];
  const count = reader.readInt32();
  for (let i = 0; i < count && reader.position < chunkEnd; i++) {
    const parentSubobject = reader.readInt32();
    reader.skipVector(); // offset
    reader.skipVector(); // view normal
    points.push({ parentSubobject });
  }
  return points;
}

function readTurretBanks(reader: BinaryReader, chunkEnd: number): PofTurretBank[] {
  const banks: PofTurretBank[] = [];
  const count = reader.readInt32();
  for (let i = 0; i < count && reader.position < chunkEnd; i++) {
    const baseSubobject = reader.readInt32();
    const gunSubobject = reader.readInt32();
    reader.skipVector(); // turret normal
    const firingPointCount = reader.readInt32();
    for (let p = 0; p < firingPointCount; p++) {
      reader.skipVector(); // firing point position
    }
    banks.push({ baseSubobject, gunSubobject, firingPointCount });
  }
  return banks;
}

/** Parses a `$key=value` token out of a POF properties string (used by DOCK's `$name=`). */
function extractPropertyValue(properties: string | null, key: string): string | null {
  if (!properties) {
    return null;
  }
  const re = new RegExp(`\\$${key}\\s*=\\s*([^\\r\\n]+)`, "i");
  const match = re.exec(properties);
  return match ? match[1].trim() : null;
}
