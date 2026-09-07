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
 * Deliberately does NOT decode geometry (BSP polygon data, shield mesh, collision
 * trees, insignia mesh data): those chunks (and the geometry portion of decoded ones)
 * are skipped wholesale via each chunk's declared `length`, which this reader always
 * trusts as the authority for where the next chunk starts, even when a per-chunk
 * field-layout guess below turns out wrong for a given POF version.
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
          model.subobjects.push(readSubobject(reader, chunkDataEnd));
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

function readTextures(reader: BinaryReader, chunkEnd: number): string[] {
  const textures: string[] = [];
  const count = reader.readInt32();
  for (let i = 0; i < count && reader.position < chunkEnd; i++) {
    const name = reader.readString();
    textures.push(name ?? "");
  }
  return textures;
}

function readSubobject(reader: BinaryReader, chunkEnd: number): PofSubobject {
  const submodelNumber = reader.readInt32();
  const parentSubmodel = reader.readInt32();
  reader.skipVector(); // offset from parent
  reader.skip(4); // radius
  reader.skipVector(); // geometric center
  reader.skipVector(); // bounding box min
  reader.skipVector(); // bounding box max
  const name = reader.position < chunkEnd ? reader.readString() : null;
  const properties = reader.position < chunkEnd ? reader.readString() : null;
  return { submodelNumber, parentSubmodel, name, properties };
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
