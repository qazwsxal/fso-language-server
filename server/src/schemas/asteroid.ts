import { TableSchema } from "./types";

/**
 * asteroid.tbl / *-ast.tbm schema.
 *
 * Field order below is a best-effort reading of the well-documented fields (identity
 * -> the three POF size-variant model files -> flight/damage stats), not transcribed
 * from asteroid.cpp - same caveat as the other schemas in this directory.
 */
export const asteroidSchema: TableSchema = {
  name: "asteroid.tbl",
  fileMatch: [/(^|[\\/])asteroid\.tbl$/i, /-ast\.tbm$/i],
  sectionNames: ["Asteroid Types"],
  entryKeyField: "Name",
  fieldOrder: [
    "Name",
    "POF file1",
    "POF file2",
    "POF file3",
    "Detail distance",
    "Max Speed",
    "Damage Type",
    "Explosion Animations",
    "Explosion Radius Mult",
  ],
};
