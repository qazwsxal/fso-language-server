import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseTable } from "../src/parser";
import { extractWeaponEntries } from "../src/tableAnalysis/weaponEntries";

test("extracts $Name:/+Field: sound refs, including the $/+ dual-sigil $Shockwave Sound: pair", () => {
  const text = [
    "#Secondary Weapons",
    "$Name: Trebuchet",
    "$LaunchSnd: 100",
    "$Shockwave Sound: 101",
    "+Shockwave Sound: 102",
    "#End",
  ].join("\n");
  const [weapon] = extractWeaponEntries(parseTable(text).sections);
  assert.deepEqual(
    weapon.soundRefs.map((r) => `${r.sigil}${r.field}=${r.value}`),
    ["$LaunchSnd=100", "$Shockwave Sound=101", "+Shockwave Sound=102"],
  );
});

test("captures an untracked top-level $Field: into miscFieldRefs, but not a dedicated field or a +sigil sub-field", () => {
  const text = [
    "#Primary Weapons",
    "$Name: Subach HL-7",
    "$Model file: fighter1.pof",
    "$Tech Model: fighter1_tech.pof",
    "$External Model File: fighter1_ext.pof",
    "$Mass: 1.0",
    "$Velocity: 350",
    "+Weapon Range: 1500",
    "#End",
  ].join("\n");
  const [weapon] = extractWeaponEntries(parseTable(text).sections);
  assert.deepEqual(
    weapon.miscFieldRefs.map((r) => `${r.field}=${r.value}`),
    ["Mass=1.0", "Velocity=350"],
  );
});

test("extracts $Tech Model: separately from $Model file:", () => {
  const text = ["#Secondary Weapons", "$Name: Trebuchet", "$Model file: trebuchet.pof", "$Tech Model: trebuchet_tech.pof", "#End"].join(
    "\n",
  );
  const [weapon] = extractWeaponEntries(parseTable(text).sections);
  assert.equal(weapon.modelFile, "trebuchet.pof");
  assert.equal(weapon.techModel, "trebuchet_tech.pof");
  assert.equal(weapon.techModelLine, 3);
});

test("extracts $External Model File: separately from $Model file:/$Tech Model:", () => {
  const text = [
    "#Secondary Weapons",
    "$Name: Trebuchet",
    "$Model file: trebuchet.pof",
    "$Tech Model: trebuchet_tech.pof",
    "$External Model File: trebuchet_ext.pof",
    "#End",
  ].join("\n");
  const [weapon] = extractWeaponEntries(parseTable(text).sections);
  assert.equal(weapon.modelFile, "trebuchet.pof");
  assert.equal(weapon.techModel, "trebuchet_tech.pof");
  assert.equal(weapon.externalModelFile, "trebuchet_ext.pof");
  assert.equal(weapon.externalModelFileLine, 4);
});

test("extracts the weapon-level $Armor Type: separately from $Damage Type:", () => {
  const text = [
    "#Secondary Weapons",
    "$Name: Trebuchet",
    "$Damage Type: Terran",
    "$Armor Type: TrebuchetShell",
    "#End",
  ].join("\n");
  const [weapon] = extractWeaponEntries(parseTable(text).sections);
  assert.equal(weapon.damageType, "Terran");
  assert.equal(weapon.armorType, "TrebuchetShell");
  assert.equal(weapon.armorTypeLine, 3);
});

test("extracts repeatable $substitute: entries, including the 'none' sentinel", () => {
  const text = [
    "#Secondary Weapons",
    "$Name: Trebuchet",
    "$substitute: Tempest",
    "+period: 3",
    "$substitute: none",
    "#End",
  ].join("\n");
  const [weapon] = extractWeaponEntries(parseTable(text).sections);
  assert.deepEqual(
    weapon.substituteRefs.map((r) => `${r.name}@${r.line}`),
    ["Tempest@2", "none@4"],
  );
});

test("extracts $Homing:'s +Ship Types:/+Species:/+IFFs: as kinded name-list refs", () => {
  const text = [
    "#Secondary Weapons",
    "$Name: Trebuchet",
    "$Homing:",
    '+Ship Types: ( "Fighter" "Bomber" )',
    '+Species: ( "Terran" )',
    '+IFFs: ( "Hostile" )',
    "#End",
  ].join("\n");
  const [weapon] = extractWeaponEntries(parseTable(text).sections);
  assert.deepEqual(
    weapon.nameListRefs.map((r) => `${r.field}:${r.kind}:${r.names.join(",")}`),
    ["Ship Types:ship-type:Fighter,Bomber", "Species:species:Terran", "IFFs:iff:Hostile"],
  );
});

test("extracts $Proximity Radius:'s +Proximity IFF:/+Proximity Class: as kinded name-list refs", () => {
  const text = [
    "#Secondary Weapons",
    "$Name: Trebuchet",
    "$Proximity Radius: 10",
    '+Proximity IFF: ( "Hostile" )',
    '+Proximity Class: ( "GTF Ulysses" )',
    "#End",
  ].join("\n");
  const [weapon] = extractWeaponEntries(parseTable(text).sections);
  assert.deepEqual(
    weapon.nameListRefs.map((r) => `${r.field}:${r.kind}:${r.names.join(",")}`),
    ["Proximity IFF:iff:Hostile", "Proximity Class:ship-class:GTF Ulysses"],
  );
});

test("extracts $Muzzleflash: and $SSM:", () => {
  const text = [
    "#Secondary Weapons",
    "$Name: Trebuchet",
    "$Muzzleflash: laser_flash",
    "$SSM: GTVA Artillery Strike",
    "#End",
  ].join("\n");
  const [weapon] = extractWeaponEntries(parseTable(text).sections);
  assert.equal(weapon.muzzleflash, "laser_flash");
  assert.equal(weapon.muzzleflashLine, 2);
  assert.equal(weapon.ssmClass, "GTVA Artillery Strike");
  assert.equal(weapon.ssmClassLine, 3);
});

test("extracts +Armor Type: nested inside a repeatable $Conditional Impact: block, separately from the top-level $Armor Type:", () => {
  const text = [
    "#Secondary Weapons",
    "$Name: Trebuchet",
    "$Armor Type: TrebuchetShell",
    "$Conditional Impact:",
    "+Armor Type: TerranFighter",
    "$Conditional Impact:",
    "+Armor Type: NO ARMOR",
    "#End",
  ].join("\n");
  const [weapon] = extractWeaponEntries(parseTable(text).sections);
  assert.equal(weapon.armorType, "TrebuchetShell");
  assert.deepEqual(
    weapon.conditionalImpactArmorRefs.map((r) => r.value),
    ["TerranFighter", "NO ARMOR"],
  );
});
