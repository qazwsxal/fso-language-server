export interface PofSubobject {
  submodelNumber: number;
  parentSubmodel: number;
  /** The subsystem/submodel name that ships.tbl `$Subsystem:` entries reference. */
  name: string | null;
  properties: string | null;
}

export interface PofDockPoint {
  /** Raw properties string, e.g. "$name=Cargo 1"; "cargo" anywhere in it marks a cargo bay. */
  properties: string | null;
  name: string | null;
  isCargoBay: boolean;
}

export interface PofPath {
  name: string | null;
  parentName: string | null;
}

export interface PofSpecialPoint {
  name: string | null;
  properties: string | null;
}

export interface PofGlowBank {
  properties: string | null;
  parentSubobject: number | null;
}

export interface PofThrusterBank {
  properties: string | null;
}

export interface PofEyePoint {
  parentSubobject: number;
}

export interface PofTurretBank {
  /** The rotating base subobject; equal to gunSubobject for single-part turrets. */
  baseSubobject: number;
  gunSubobject: number;
  firingPointCount: number;
}

export interface PofModel {
  version: number;
  textures: string[];
  subobjects: PofSubobject[];
  dockPoints: PofDockPoint[];
  paths: PofPath[];
  specialPoints: PofSpecialPoint[];
  glowBanks: PofGlowBank[];
  thrusterBanks: PofThrusterBank[];
  /** Free-form build-info string from the PINF chunk (e.g. the exporter/command line that produced this POF). */
  buildInfo: string | null;
  eyePoints: PofEyePoint[];
  /**
   * Bank counts only from GPNT/MPNT (gun/missile firing points) - the per-point layout
   * within a bank has a version-dependent optional trailing field (external model angle
   * offset, POF v21.18+) with no safe way to detect its presence the way a
   * length-prefixed string can, so walking past the first bank risks misreading; see
   * the pof-file-format project memory. Bank *counts* are enough to validate against a
   * ships.tbl/weapons.tbl `$num_primary_banks`-style field even without full decoding.
   */
  primaryBankCount: number | null;
  secondaryBankCount: number | null;
  turretGunBanks: PofTurretBank[];
  turretMissileBanks: PofTurretBank[];
  /** Single autocentering point (tech-room rotation pivot) from ACEN, if present. */
  autocenterPoint: { x: number; y: number; z: number } | null;
  /** Count only from INSG (squad insignia decal meshes) - unnamed/index-referenced, so a count is all that's useful here. */
  insigniaCount: number;
  /** Chunk IDs present that this reader doesn't decode (informational, e.g. for diagnostics/telemetry). */
  unhandledChunkIds: string[];
}
