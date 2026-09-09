import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseTable } from "../src/parser";
import { extractShipEntries } from "../src/tableAnalysis/shipEntries";

test("extracts $Explosion Animations: as a quoted name list", () => {
  const text = [
    "#Ship Classes",
    "$Name: GTF Ulysses",
    '$Explosion Animations: ( "ShipExpl01" "ShipExpl02" )',
    "#End",
  ].join("\n");
  const [ship] = extractShipEntries(parseTable(text).sections);
  assert.deepEqual(ship.explosionAnimations, ["ShipExpl01", "ShipExpl02"]);
  assert.equal(ship.explosionAnimationsLine, 2);
});

test("extracts $Target Priority Groups: as an unquoted whitespace-separated list", () => {
  const text = ["#Ship Classes", "$Name: GTF Ulysses", "$Target Priority Groups: ( Fighter Bomber )", "#End"].join("\n");
  const [ship] = extractShipEntries(parseTable(text).sections);
  assert.deepEqual(ship.targetPriorityGroups, ["Fighter", "Bomber"]);
  assert.equal(ship.targetPriorityGroupsLine, 2);
});

test("does not attribute $Target Priority Groups: to a ship when it appears inside a $Subsystem: block", () => {
  const text = [
    "#Ship Classes",
    "$Name: GTF Ulysses",
    "$Subsystem: turret01, 5, 3",
    "$Target Priority Groups: ( Fighter )",
    "#End",
  ].join("\n");
  const [ship] = extractShipEntries(parseTable(text).sections);
  assert.deepEqual(ship.targetPriorityGroups, []);
  assert.equal(ship.targetPriorityGroupsLine, null);
});

test("extracts ship-level and per-subsystem sound fields into a single flat soundRefs list", () => {
  const text = [
    "#Ship Classes",
    "$Name: GTF Ulysses",
    "$EngineSnd: 20",
    "$Subsystem: turret01, 5, 3",
    "$AliveSnd: 47",
    "$DeadSnd: 48",
    "#End",
  ].join("\n");
  const [ship] = extractShipEntries(parseTable(text).sections);
  assert.deepEqual(
    ship.soundRefs.map((r) => `${r.field}=${r.value}@${r.line}`),
    ["EngineSnd=20@2", "AliveSnd=47@4", "DeadSnd=48@5"],
  );
});

test("captures the same field name used twice under different parent blocks (+Ambient Sound:) as two distinct refs", () => {
  const text = [
    "#Ship Classes",
    "$Name: GTF Ulysses",
    "$Collision Physics:",
    "+Ambient Sound: 10",
    "$Debris:",
    "+Ambient Sound: 11",
    "#End",
  ].join("\n");
  const [ship] = extractShipEntries(parseTable(text).sections);
  assert.deepEqual(
    ship.soundRefs.map((r) => r.value),
    ["10", "11"],
  );
});

test("captures an untracked top-level $Field: into miscFieldRefs, but not a dedicated field or a bare marker", () => {
  const text = [
    "#Ship Classes",
    "$Name: GTF Ulysses",
    "$Species: Terran",
    "$Score: 15",
    "$Density: 1.5",
    "$Collision Physics:",
    "#End",
  ].join("\n");
  const [ship] = extractShipEntries(parseTable(text).sections);
  assert.deepEqual(
    ship.miscFieldRefs.map((r) => `${r.field}=${r.value}`),
    ["Score=15", "Density=1.5"],
  );
});

test("does not attribute a $Field: inside a $Subsystem: block to the ship's miscFieldRefs", () => {
  const text = ["#Ship Classes", "$Name: GTF Ulysses", "$Subsystem: turret01, 5, 3", "$Engine Wash: 3", "#End"].join("\n");
  const [ship] = extractShipEntries(parseTable(text).sections);
  assert.deepEqual(ship.miscFieldRefs, []);
});
