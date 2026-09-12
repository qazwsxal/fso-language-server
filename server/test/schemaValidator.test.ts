import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseTable } from "../src/parser";
import { validateAgainstSchema } from "../src/schemaValidator";
import { weaponsSchema } from "../src/schemas/weapons";
import { shipsSchema } from "../src/schemas/ships";
import { mainhallSchema } from "../src/schemas/mainhall";
import { objectTypesSchema } from "../src/schemas/objectTypes";
import { intelSchema } from "../src/schemas/intel";

test("does not flag $Impact Explosion:/$Impact Explosion Radius: as out-of-order when they follow $Trail: (real missile weapons.tbl shape)", () => {
  const text = [
    "#Secondary Weapons",
    "$Name: Trebuchet",
    '$Flags:                ( "Big Ship" "detonate on expiration" )',
    "$Trail:",
    "  +Start Width:  3.0",
    "  +End Width:    3.0",
    "  +Start Alpha:  1.0",
    "  +End Alpha:    0.0",
    "  +Max Life:     0.10",
    "  +Bitmap:       missiletrail02",
    "$Impact Explosion:        MS_Impact",
    "$Impact Explosion Radius: 6.0",
    "#End",
  ].join("\n");

  const { sections } = parseTable(text);
  const diagnostics = validateAgainstSchema(sections, weaponsSchema);
  assert.deepEqual(diagnostics, []);
});

test("flags a weapons.tbl-only field (Model file) pasted into a ships.tbl entry as misplaced, always as a warning", () => {
  const text = ["#Ship Classes", "$Name: GTF Ulysses", "$Model file: fighter1.pof", "#End"].join("\n");
  const { sections } = parseTable(text);
  const diagnostics = validateAgainstSchema(sections, shipsSchema, "error");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].severity, "warning");
  assert.match(diagnostics[0].message, /weapons\.tbl field, not recognized in ships\.tbl/);
});

test("flags a ships.tbl-only field (POF file) pasted into a weapons.tbl entry as misplaced", () => {
  const text = ["#Primary Weapons", "$Name: Subach HL-7", "$POF file: fighter1.pof", "#End"].join("\n");
  const { sections } = parseTable(text);
  const diagnostics = validateAgainstSchema(sections, weaponsSchema);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0].message, /ships\.tbl field, not recognized in weapons\.tbl/);
});

test("does not flag $Alt name:/$Countermeasure type: in ships.tbl - both genuinely shared with weapons.tbl/species_defs.tbl respectively (real Blue Planet false positive)", () => {
  const text = [
    "#Ship Classes",
    "$Name: GTF Ulysses",
    "$Alt name: Ulysses Mk II",
    "$POF Target LOD: 3",
    "$Countermeasure type: Cluster Bomb",
    "#End",
  ].join("\n");
  const { sections } = parseTable(text);
  const diagnostics = validateAgainstSchema(sections, shipsSchema, "error");
  assert.deepEqual(diagnostics, []);
});

test("does not flag $Shockwave Damage Type:/$Shockwave model:/$Shockwave Name: in ships.tbl - a ship's own death shockwave is a real, separate ships.tbl field cluster from a weapon's impact shockwave (real Star Fox Event Horizon ships.tbl false positive)", () => {
  const text = [
    "#Ship Classes",
    "$Name: GTF Ulysses",
    "$Shockwave Damage Type: Blast",
    "$Shockwave Speed: 300",
    "$Shockwave Count: 1",
    "$Shockwave model: shockwave01.pof",
    "$Shockwave Name: ShockwaveLarge",
    "#End",
  ].join("\n");
  const { sections } = parseTable(text);
  const diagnostics = validateAgainstSchema(sections, shipsSchema, "error");
  assert.deepEqual(diagnostics, []);
});

test("mainhallSchema activates on a real, genuinely headerless mainhall.tbl (bare $Main Hall marker, not $Name:) and order-checks its fields", () => {
  // An earlier version of this schema used entryKeyField: "Name" and
  // sectionNames: ["Main Halls"] - neither ever matches a real mainhall.tbl (headerless,
  // entries keyed by a bare `$Main Hall` marker), so validateAgainstSchema()'s
  // entryKeyFieldSeen guard silently skipped the section entirely and this schema
  // validated nothing at all. Confirmed against real Blue Planet bp-main-hall.tbm.
  const text = ["$Main Hall", "+Name: mainhall1", "$Music: briefing", "$Bitmap: mainhall1", "#End"].join("\n");
  const { sections } = parseTable(text);
  const diagnostics = validateAgainstSchema(sections, mainhallSchema, "error");
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0].message, /out of the expected field order/i);
});

test("does not flag $Target Priority Groups: in an objecttypes.tbl #Ship Types entry - genuinely shared with ships.tbl (real Blue Planet false positive)", () => {
  const text = ["#Ship Types", "$Name: fighter", "$Target Priority Groups: ( bomber )", "#End"].join("\n");
  const { sections } = parseTable(text);
  const diagnostics = validateAgainstSchema(sections, objectTypesSchema, "error");
  assert.deepEqual(diagnostics, []);
});

test("a field owned by 3+ other schemas (Bitmap: rank.tbl/mainhall.tbl/medals.tbl) is ambiguous - never flagged as misplaced, and never reported as unknown either", () => {
  const text = ["#Ship Classes", "$Name: GTF Ulysses", "$Bitmap: some_icon", "#End"].join("\n");
  const { sections } = parseTable(text);
  const diagnostics = validateAgainstSchema(sections, shipsSchema, "error");
  assert.deepEqual(diagnostics, []);
});

test("unknownFieldSeverity defaults to off - a genuinely unrecognized field is silent", () => {
  const text = ["#Ship Classes", "$Name: GTF Ulysses", "$Totally Made Up Field: 1", "#End"].join("\n");
  const { sections } = parseTable(text);
  assert.deepEqual(validateAgainstSchema(sections, shipsSchema), []);
});

test("unknownFieldSeverity: 'warning'/'error' report a genuinely unrecognized field at that severity", () => {
  const text = ["#Ship Classes", "$Name: GTF Ulysses", "$Totally Made Up Field: 1", "#End"].join("\n");
  const { sections } = parseTable(text);

  const warnings = validateAgainstSchema(sections, shipsSchema, "warning");
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, "warning");
  assert.match(warnings[0].message, /not a field ships\.tbl recognizes/);

  const errors = validateAgainstSchema(sections, shipsSchema, "error");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].severity, "error");
});

test("does not flag $Impact Explosion Radius:/$Piercing Impact Explosion: as out-of-order in a real missile entry (second false positive, full field cluster)", () => {
  const text = [
    "#Secondary Weapons",
    "$Name: Trebuchet",
    "+Weapon Range:            1400",
    '$Flags:                   ( "Big Ship" "detonate on expiration" )',
    "$Trail:",
    "  +Start Width:  3.0",
    "  +End Width:    3.0",
    "  +Start Alpha:  1.0",
    "  +End Alpha:    0.0",
    "  +Max Life:     0.10",
    "  +Bitmap:       missiletrail02",
    "$Impact Explosion:              MS_Impact",
    "$Impact Explosion Radius:       6.0",
    "$Piercing Impact Explosion:     ParticleSmoke01",
    "#End",
  ].join("\n");

  const { sections } = parseTable(text);
  const diagnostics = validateAgainstSchema(sections, weaponsSchema);
  assert.deepEqual(diagnostics, []);
});

test("intelSchema activates on a real, genuinely headerless intel.tbl (bare $Entry: marker, real identity on the following $Name:) and order-checks its fields", () => {
  const text = [
    "$Entry:",
    "$Name: XSTR(\"Terrans\", 9746)",
    "$Anim: Intel_Terrans",
    "$AlwaysInTechRoom: 1",
    "$Description:",
    'XSTR("Some species description.", 9747)',
    "$end_multi_text",
    "$Custom Data:",
    '\t+Val: Category ("Known Species", 9759)',
    "$end_custom_data",
    "$Entry:",
    "$Name: XSTR(\"Vasudans\", 1130)",
    "$Anim: Intel_Vasudans",
  ].join("\n");
  const { sections } = parseTable(text);
  const diagnostics = validateAgainstSchema(sections, intelSchema, "error");
  assert.deepEqual(diagnostics, []);
});
