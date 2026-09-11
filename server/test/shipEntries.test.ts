import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseTable } from "../src/parser";
import { extractShipEntries, extractShipTemplateEntries } from "../src/tableAnalysis/shipEntries";

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

test("extracts $Cockpit POF file:/$POF file Techroom:/$POF target file: separately from $POF file:", () => {
  const text = [
    "#Ship Classes",
    "$Name: GTF Ulysses",
    "$POF file: fighter1.pof",
    "$Cockpit POF file: fighter1_cockpit.pof",
    "$POF file Techroom: fighter1_tech.pof",
    "$POF target file: fighter1_hud.pof",
    "#End",
  ].join("\n");
  const [ship] = extractShipEntries(parseTable(text).sections);
  assert.equal(ship.modelFile, "fighter1.pof");
  assert.equal(ship.cockpitModelFile, "fighter1_cockpit.pof");
  assert.equal(ship.cockpitModelFileLine, 3);
  assert.equal(ship.techModel, "fighter1_tech.pof");
  assert.equal(ship.techModelLine, 4);
  assert.equal(ship.hudTargetModelFile, "fighter1_hud.pof");
  assert.equal(ship.hudTargetModelFileLine, 5);
});

test("extracts +Generic Debris POF file: nested inside $Debris: as a model reference, not a misc field", () => {
  const text = [
    "#Ship Classes",
    "$Name: GTF Ulysses",
    "$Debris:",
    "+Min Lifetime: 1.0",
    "+Generic Debris POF file: fighter1_debris.pof",
    "+Max Lifetime: 5.0",
    "#End",
  ].join("\n");
  const [ship] = extractShipEntries(parseTable(text).sections);
  assert.equal(ship.genericDebrisModelFile, "fighter1_debris.pof");
  assert.equal(ship.genericDebrisModelFileLine, 4);
  assert.deepEqual(ship.miscFieldRefs, []);
});

test("extracts $Countermeasure type: as a weapon-name reference", () => {
  const text = ["#Ship Classes", "$Name: GTF Ulysses", "$Countermeasure type: Cluster Bomb", "#End"].join("\n");
  const [ship] = extractShipEntries(parseTable(text).sections);
  assert.equal(ship.countermeasureType, "Cluster Bomb");
  assert.equal(ship.countermeasureTypeLine, 2);
});

test("extracts +Use Template:/+Use Ship as Template: as two distinct cross-references", () => {
  const text = [
    "#Ship Classes",
    "$Name: GTVA Fighter A",
    "+Use Template: FighterBaseTemplate",
    "$Name: GTVA Fighter B",
    "+Use Ship as Template: GTVA Fighter A",
    "#End",
  ].join("\n");
  const [shipA, shipB] = extractShipEntries(parseTable(text).sections);
  assert.equal(shipA.useTemplate, "FighterBaseTemplate");
  assert.equal(shipA.useTemplateLine, 2);
  assert.equal(shipA.useShipAsTemplate, null);
  assert.equal(shipB.useTemplate, null);
  assert.equal(shipB.useShipAsTemplate, "GTVA Fighter A");
  assert.equal(shipB.useShipAsTemplateLine, 4);
});

test("extractShipTemplateEntries: reads #Ship Templates entries keyed by $Template:, ignoring #Ship Classes", () => {
  const text = [
    "#Ship Templates",
    "$Template: FighterBaseTemplate",
    "$Template: BomberBaseTemplate",
    "+Use Template: FighterBaseTemplate",
    "#End",
    "#Ship Classes",
    "$Name: GTF Ulysses",
    "#End",
  ].join("\n");
  const templates = extractShipTemplateEntries(parseTable(text).sections);
  assert.deepEqual(
    templates.map((t) => t.name),
    ["FighterBaseTemplate", "BomberBaseTemplate"],
  );
  assert.equal(templates[0].useTemplate, null);
  assert.equal(templates[1].useTemplate, "FighterBaseTemplate");
  assert.equal(templates[1].useTemplateLine, 3);
});

test("extracts $Default Team:", () => {
  const text = ["#Ship Classes", "$Name: GTF Ulysses", "$Default Team: Hostile", "#End"].join("\n");
  const [ship] = extractShipEntries(parseTable(text).sections);
  assert.equal(ship.defaultTeam, "Hostile");
  assert.equal(ship.defaultTeamLine, 2);
});

test("extracts $Ship IFF Colors:'s +Seen By:/+When IFF Is: as two iff_defs.tbl name refs per occurrence", () => {
  const text = [
    "#Ship Classes",
    "$Name: GTF Ulysses",
    "$Ship IFF Colors:",
    "+Seen By: Friendly",
    "+When IFF Is: Hostile",
    "+As Color: ( 255 0 0 )",
    "$Ship IFF Colours:",
    "+Seen By: Hostile",
    "+When IFF Is: Friendly",
    "+As Color: ( 0 255 0 )",
    "#End",
  ].join("\n");
  const [ship] = extractShipEntries(parseTable(text).sections);
  assert.deepEqual(
    ship.iffColorRefs.map((r) => `${r.field}=${r.value}@${r.line}`),
    ["Seen By=Friendly@3", "When IFF Is=Hostile@4", "Seen By=Hostile@7", "When IFF Is=Friendly@8"],
  );
});
