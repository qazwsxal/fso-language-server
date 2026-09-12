import { TableSchema } from "./types";

/**
 * cutscenes.tbl / *-csn.tbm schema - the list of cutscene entries shown in the tech
 * room's cutscene viewer.
 *
 * Confirmed against `code/cutscene/cutscenes.cpp`: each entry is actually keyed by
 * `$Filename:`, not `$Name:` (an earlier guess - the same "wrong entryKeyField silently
 * validates nothing" failure mode found elsewhere in this project, e.g. mainhall.ts/
 * aiProfiles.ts) - `$Name:` is itself an optional per-entry field (a display name),
 * parsed right after. `$Never Viewable:` (flagged as unrecognized by a real Blue
 * Planet BPIntro-csn.tbm) and its `$Always Viewable:`/`$cd:`/`$Custom data:` siblings
 * are real fields in their confirmed source order too.
 */
export const cutscenesSchema: TableSchema = {
  name: "cutscenes.tbl",
  fileMatch: [/(^|[\\/])cutscenes\.tbl$/i, /-csn\.tbm$/i],
  sectionNames: ["Cutscenes"],
  entryKeyField: "Filename",
  fieldOrder: ["Filename", "Name", "Description", "cd", "Always Viewable", "Never Viewable", "Custom data"],
};
