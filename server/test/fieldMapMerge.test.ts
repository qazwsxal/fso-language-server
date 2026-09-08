import { test } from "node:test";
import * as assert from "node:assert/strict";
import { applyNamedFieldRefs, FieldMapEntry } from "../src/tableAnalysis/fieldMapMerge";

test("sets a field's value and source, keyed by lowercased field name", () => {
  const target = new Map<string, FieldMapEntry>();
  applyNamedFieldRefs(target, [{ field: "EngineSnd", value: "4" }], "base.tbl");

  assert.deepEqual(target.get("enginesnd"), { field: "EngineSnd", value: "4", source: "base.tbl" });
});

test("a later layer only overwrites the specific fields it mentions, leaving others from earlier layers untouched", () => {
  const target = new Map<string, FieldMapEntry>();
  applyNamedFieldRefs(target, [{ field: "EngineSnd", value: "4" }, { field: "GlideStartSnd", value: "17" }], "base.tbl");
  applyNamedFieldRefs(target, [{ field: "EngineSnd", value: "99" }], "override.tbm");

  assert.equal(target.get("enginesnd")?.value, "99");
  assert.equal(target.get("enginesnd")?.source, "override.tbm");
  assert.equal(target.get("glidestartsnd")?.value, "17");
  assert.equal(target.get("glidestartsnd")?.source, "base.tbl");
});

test("field-name matching is case-insensitive across layers", () => {
  const target = new Map<string, FieldMapEntry>();
  applyNamedFieldRefs(target, [{ field: "EngineSnd", value: "4" }], "base.tbl");
  applyNamedFieldRefs(target, [{ field: "enginesnd", value: "5" }], "override.tbm");

  assert.equal(target.size, 1);
  assert.equal(target.get("enginesnd")?.value, "5");
});
