import { test } from "node:test";
import * as assert from "node:assert/strict";
import { compareVersions, satisfiesConstraint, pickBestVersion } from "../src/modResolution/semver";

test("compareVersions: compares component-wise, treating missing components as 0", () => {
  assert.equal(compareVersions("4.6.8", "4.6.8"), 0);
  assert.ok(compareVersions("4.6.9", "4.6.8") > 0);
  assert.ok(compareVersions("4.7.0", "4.6.8") > 0);
  assert.ok(compareVersions("5.0.0", "4.7.3") > 0);
  assert.ok(compareVersions("4.6", "4.6.0") === 0);
});

test("satisfiesConstraint: ~X.Y.Z requires the same major.minor, patch >= Z (Knossos's own semantics)", () => {
  assert.equal(satisfiesConstraint("4.6.8", "~4.6.8"), true);
  assert.equal(satisfiesConstraint("4.6.9", "~4.6.8"), true);
  assert.equal(satisfiesConstraint("4.6.7", "~4.6.8"), false);
  assert.equal(satisfiesConstraint("4.7.0", "~4.6.8"), false, "different minor must not satisfy a tilde constraint");
  assert.equal(satisfiesConstraint("5.0.2", "~4.6.8"), false, "different major must not satisfy a tilde constraint");
});

test("satisfiesConstraint: no constraint means anything satisfies", () => {
  assert.equal(satisfiesConstraint("5.0.2", undefined), true);
  assert.equal(satisfiesConstraint("5.0.2", ""), true);
});

test("pickBestVersion: picks the highest candidate that satisfies a real constraint, not the highest overall", () => {
  const candidates = [{ v: "4.6.2" }, { v: "4.6.8" }, { v: "4.7.3" }, { v: "5.0.2" }];
  const best = pickBestVersion(candidates, (c) => c.v, "~4.6.8");
  assert.deepEqual(best, { v: "4.6.8" });
});

test("pickBestVersion: returns null when a real constraint is given but nothing installed satisfies it - mirrors Knossos.NET's ModDependency.SelectMod() (no silent substitution)", () => {
  const candidates = [{ v: "4.5.0" }, { v: "4.7.3" }, { v: "5.0.2" }];
  const best = pickBestVersion(candidates, (c) => c.v, "~4.6.8");
  assert.equal(best, null);
});

test("pickBestVersion: no constraint at all still picks the highest installed - Knossos: 'the mod will use the newest installed version available'", () => {
  const candidates = [{ v: "4.5.0" }, { v: "4.7.3" }, { v: "5.0.2" }];
  const best = pickBestVersion(candidates, (c) => c.v, undefined);
  assert.deepEqual(best, { v: "5.0.2" });
});
