import { TableSchema } from "./types";

/** cutscenes.tbl / *-csn.tbm schema - the list of cutscene entries shown in the tech room's cutscene viewer. */
export const cutscenesSchema: TableSchema = {
  name: "cutscenes.tbl",
  fileMatch: [/(^|[\\/])cutscenes\.tbl$/i, /-csn\.tbm$/i],
  sectionNames: ["Cutscenes"],
  entryKeyField: "Name",
  fieldOrder: ["Name", "Filename", "Description"],
};
