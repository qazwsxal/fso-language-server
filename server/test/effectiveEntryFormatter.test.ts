import { test } from "node:test";
import * as assert from "node:assert/strict";
import {
  renderEffectiveShipFieldTable,
  renderEffectiveWeaponFieldTable,
  computeSharedSourcePrefix,
  stripSharedSourcePrefix,
} from "../src/tableAnalysis/effectiveEntryFormatter";
import { EffectiveShipEntry } from "../src/tableAnalysis/mergedShipTable";
import { EffectiveWeaponEntry } from "../src/tableAnalysis/mergedWeaponsTable";

function baseShipEntry(): EffectiveShipEntry {
  return {
    name: "GTF Ulysses",
    nameLocation: null,
    allLocations: [],
    modelFile: "fighter3.pof",
    modelFileSource: "bp-shp.tbm:496",
    cockpitModelFile: null,
    cockpitModelFileSource: null,
    techModel: null,
    techModelSource: null,
    hudTargetModelFile: null,
    hudTargetModelFileSource: null,
    genericDebrisModelFile: null,
    genericDebrisModelFileSource: null,
    countermeasureType: null,
    countermeasureTypeSource: null,
    useTemplate: null,
    useTemplateSource: null,
    useShipAsTemplate: null,
    useShipAsTemplateSource: null,
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
    miscFieldsByField: new Map(),
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
    techModel: null,
    techModelSource: null,
    externalModelFile: null,
    externalModelFileSource: null,
    damageType: "Terran",
    damageTypeSource: "weapons.tbl:156",
    soundsByField: new Map([["impactsnd", { field: "ImpactSnd", value: "85", source: "bp-wep.tbm:28" }]]),
    texturesByField: new Map(),
    miscFieldsByField: new Map(),
    layerSources: ["weapons.tbl:156", "bp-wep.tbm:28"],
  };
}

test("renders a ship's set fields (not already in the hover's top summary) as a Markdown table", () => {
  const text = renderEffectiveShipFieldTable(baseShipEntry());
  assert.match(text, /^\| Field \| Value \| Source \|$/m);
  assert.match(text, /^\| --- \| --- \| --- \|$/m);
  assert.match(text, /\| Species \| Terran \| mv_root-shp\.tbm:5 \|/);
  assert.match(text, /\| AI Class \| Fighter \| ships\.tbl:144 \|/);
  assert.match(text, /\| EngineSnd \| 4 \| mv_effects-shp\.tbm:12 \|/);
});

test("does not include fields already shown in the hover's top summary (Model File/Subsystems/Armor Type/bank lists)", () => {
  const text = renderEffectiveShipFieldTable(baseShipEntry());
  assert.doesNotMatch(text, /Model File/);
  assert.doesNotMatch(text, /TerranFighter/); // the top summary's own Armor Type value shouldn't leak into the table
  assert.doesNotMatch(text, /Default PBanks/);
});

test("omits unset fields entirely - no wall of empty rows for the other ~50 possible sound fields", () => {
  const text = renderEffectiveShipFieldTable(baseShipEntry());
  assert.doesNotMatch(text, /GlideStartSnd/);
  assert.doesNotMatch(text, /Target Priority Groups/);
  assert.doesNotMatch(text, /Explosion Animations/);
});

test("renders nothing (empty string) when there are no fields to add beyond the top summary", () => {
  const ship = baseShipEntry();
  ship.species = null;
  ship.aiClass = null;
  ship.soundsByField = new Map();
  const text = renderEffectiveShipFieldTable(ship);
  assert.equal(text, "");
});

test("renders a weapon's Damage Type plus set sound/texture/misc fields as a table", () => {
  const text = renderEffectiveWeaponFieldTable(baseWeaponEntry());
  assert.match(text, /\| Damage Type \| Terran \| weapons\.tbl:156 \|/);
  assert.match(text, /\| ImpactSnd \| 85 \| bp-wep\.tbm:28 \|/);
});

test("includes untracked (misc) fields in the table", () => {
  const ship = baseShipEntry();
  ship.miscFieldsByField.set("score", { field: "Score", value: "15", source: "ships.tbl:144" });
  const text = renderEffectiveShipFieldTable(ship);
  assert.match(text, /\| Score \| 15 \| ships\.tbl:144 \|/);
});

test("escapes a stray pipe in a value so it can't break the table row", () => {
  const ship = baseShipEntry();
  ship.miscFieldsByField.set("weird", { field: "Weird", value: "a | b", source: "ships.tbl:1" });
  const text = renderEffectiveShipFieldTable(ship);
  assert.match(text, /\| Weird \| a \\\| b \| ships\.tbl:1 \|/);
});

test("computeSharedSourcePrefix: finds the longest common directory prefix, trimmed to a path separator", () => {
  const prefix = computeSharedSourcePrefix([
    "E:\\Games\\Knossos\\FS2\\Root_fs2.vp :: data/tables/weapons.tbl",
    "E:\\Games\\Knossos\\FS2\\MVPS-4.7.3\\MV_Root.vpc :: data/tables/mv_root-wep.tbm",
    "E:\\Games\\Knossos\\FS2\\blueplanetcomplete-3.3.3\\data\\tables\\bp-wep.tbm",
  ]);
  assert.equal(prefix, "E:\\Games\\Knossos\\FS2\\");
});

test("computeSharedSourcePrefix: does not split a path segment in half (e.g. two mods with overlapping name prefixes)", () => {
  const prefix = computeSharedSourcePrefix(["C:\\mods\\bp-core\\weapons.tbl", "C:\\mods\\bp-extra\\weapons.tbl"]);
  assert.equal(prefix, "C:\\mods\\");
});

test("computeSharedSourcePrefix: returns \"\" for fewer than 2 sources or when nothing is shared", () => {
  assert.equal(computeSharedSourcePrefix(["only-one.tbl"]), "");
  assert.equal(computeSharedSourcePrefix([]), "");
  assert.equal(computeSharedSourcePrefix(["C:\\a\\x.tbl", "D:\\b\\y.tbl"]), "");
});

test("stripSharedSourcePrefix: strips only when the source actually starts with the prefix", () => {
  assert.equal(stripSharedSourcePrefix("C:\\mods\\bp\\weapons.tbl", "C:\\mods\\"), "bp\\weapons.tbl");
  assert.equal(stripSharedSourcePrefix("D:\\other\\weapons.tbl", "C:\\mods\\"), "D:\\other\\weapons.tbl");
  assert.equal(stripSharedSourcePrefix("C:\\mods\\bp\\weapons.tbl", ""), "C:\\mods\\bp\\weapons.tbl");
});

test("renderEffectiveShipFieldTable/renderEffectiveWeaponFieldTable strip a given sharedPrefix from every Source cell", () => {
  const ship = baseShipEntry();
  ship.speciesSource = "C:\\mods\\bp\\mv_root-shp.tbm:5";
  const text = renderEffectiveShipFieldTable(ship, "C:\\mods\\bp\\");
  assert.match(text, /\| Species \| Terran \| mv_root-shp\.tbm:5 \|/);
  assert.doesNotMatch(text, /C:\\mods/);
});
