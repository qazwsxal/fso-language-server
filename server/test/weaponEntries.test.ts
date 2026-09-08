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
