import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseTable } from "../src/parser";
import { validateAgainstSchema } from "../src/schemaValidator";
import { weaponsSchema } from "../src/schemas/weapons";

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
