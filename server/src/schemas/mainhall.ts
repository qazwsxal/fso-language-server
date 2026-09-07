import { TableSchema } from "./types";

/**
 * mainhall.tbl / *-hall.tbm schema - main hall (front-end UI) definitions. Real
 * entries carry many more nested fields (door regions, ambient sounds, etc.); this
 * schema only covers the well-documented top few, same conservative approach as the
 * other schemas here.
 */
export const mainhallSchema: TableSchema = {
  name: "mainhall.tbl",
  fileMatch: [/(^|[\\/])mainhall\.tbl$/i, /-hall\.tbm$/i],
  sectionNames: ["Main Halls"],
  entryKeyField: "Name",
  fieldOrder: ["Name", "Bitmap", "Mask", "Music"],
};
