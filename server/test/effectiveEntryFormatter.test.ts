import { test } from "node:test";
import * as assert from "node:assert/strict";
import { renderEffectiveShipEntry, renderEffectiveWeaponEntry } from "../src/tableAnalysis/effectiveEntryFormatter";
import { EffectiveShipEntry } from "../src/tableAnalysis/mergedShipTable";
import { EffectiveWeaponEntry } from "../src/tableAnalysis/mergedWeaponsTable";

function baseShipEntry(): EffectiveShipEntry {
  return {
    name: "GTF Ulysses",
    nameLocation: null,
    allLocations: [],
    modelFile: "fighter3.pof",
    modelFileSource: "bp-shp.tbm:496",
    subsystems: [],
    subsystemsSource: null,
    defaultPrimaryBanks: { line: 0, weaponNames: ["Subach HL-7", "ML-16"] },
    defaultPrimaryBanksSource: "bp-shp.tbm:510",
    defaultSecondaryBanks: null,
    defaultSecondaryBanksSource: null,
    armorType: "TerranFighter",
    armorTypeSource: "actuallights-shp.tbm:23",
    shieldArmorType: null,
    shieldArmorTypeSource: null,
    species: "Terran",
    speciesSource: "mv_root-shp.tbm:5",
    aiClass: "Fighter",
    aiClassSource: "ships.tbl:144",
    targetPriorityGroups: [],
    targetPriorityGroupsSource: null,
    explosionAnimations: [],
    explosionAnimationsSource: null,
    soundsByField: new Map([["enginesnd", { field: "EngineSnd", value: "4", source: "mv_effects-shp.tbm:12" }]]),
    texturesByField: new Map(),
    layerSources: ["ships.tbl:144", "mv_root-shp.tbm:5", "bp-shp.tbm:496"],
  };
}

function baseWeaponEntry(): EffectiveWeaponEntry {
  return {
    name: "Mekhu HL-7",
    nameLocation: null,
    allLocations: [],
    modelFile: null,
    modelFileSource: null,
    damageType: "Terran",
    damageTypeSource: "weapons.tbl:156",
    soundsByField: new Map([["impactsnd", { field: "ImpactSnd", value: "85", source: "bp-wep.tbm:28" }]]),
    texturesByField: new Map(),
    layerSources: ["weapons.tbl:156", "bp-wep.tbm:28"],
  };
}

test("renders a ship's set scalar fields with their winning value and provenance", () => {
  const text = renderEffectiveShipEntry(baseShipEntry());

  assert.match(text, /\$Name: GTF Ulysses/);
  assert.match(text, /\$Model File: fighter3\.pof ;; bp-shp\.tbm:496/);
  assert.match(text, /\$Species: Terran ;; mv_root-shp\.tbm:5/);
  assert.match(text, /\$AI Class: Fighter ;; ships\.tbl:144/);
  assert.match(text, /\$Default PBanks: \( "Subach HL-7" "ML-16" \) ;; bp-shp\.tbm:510/);
});

test("renders an unset core scalar field as (none), matching existing hover behavior", () => {
  const text = renderEffectiveShipEntry(baseShipEntry());
  assert.match(text, /\$Shield Armor Type: \(none\)/);
  assert.match(text, /\$Default SBanks: \(none\)/);
});

test("only renders sound/texture fields that were actually set - no wall of (none) for the other ~50 possible sound fields", () => {
  const text = renderEffectiveShipEntry(baseShipEntry());
  assert.match(text, /\$EngineSnd: 4 ;; mv_effects-shp\.tbm:12/);
  assert.doesNotMatch(text, /GlideStartSnd/);
});

test("renders the layers-applied footer in application order", () => {
  const text = renderEffectiveShipEntry(baseShipEntry());
  const footerIndex = text.indexOf("Layers applied");
  assert.ok(footerIndex >= 0);
  const footer = text.slice(footerIndex);
  assert.match(footer, /1\. ships\.tbl:144/);
  assert.match(footer, /2\. mv_root-shp\.tbm:5/);
  assert.match(footer, /3\. bp-shp\.tbm:496/);
});

test("states up front that this is a synthesized, partial view - not real FSO syntax", () => {
  const text = renderEffectiveShipEntry(baseShipEntry());
  assert.match(text, /not valid FSO table syntax/);
  assert.match(text, /not the complete real field set/);
});

test("renders a weapon entry's fields the same way", () => {
  const text = renderEffectiveWeaponEntry(baseWeaponEntry());
  assert.match(text, /\$Name: Mekhu HL-7/);
  assert.match(text, /\$Damage Type: Terran ;; weapons\.tbl:156/);
  assert.match(text, /\$ImpactSnd: 85 ;; bp-wep\.tbm:28/);
  assert.match(text, /\$Model File: \(none\)/);
});
