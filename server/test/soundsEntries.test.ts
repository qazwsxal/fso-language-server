import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseTable } from "../src/parser";
import { extractSoundEntries } from "../src/tableAnalysis/soundsEntries";

test("extracts a plain numeric-index $Name identity, ignoring the packed filename/params on the same line", () => {
  const text = ["#Game Sounds Start", "$Name:\t92\tm_angel.wav,\t\t0, 0.80, 1,  50, 400\t; angel fire missile launch", "#Game Sounds End"].join(
    "\n",
  );
  const [entry] = extractSoundEntries(parseTable(text).sections);
  assert.equal(entry.kind, "game");
  assert.equal(entry.name, "92");
  assert.equal(entry.noCreate, false);
});

test("extracts +nocreate packed onto the $Name line itself, not as a separate field", () => {
  const text = ["#Game Sounds Start", "$Name:\t+nocreate \t4\tship_p,\t\t\t0, 0.30, 0\t; engine sound", "#Game Sounds End"].join("\n");
  const [entry] = extractSoundEntries(parseTable(text).sections);
  assert.equal(entry.name, "4");
  assert.equal(entry.noCreate, true);
});

test("extracts a bare descriptive name with no packed params", () => {
  const text = ["#Game Sounds Start", "$Name:\tMV_Missile", "+Entry: missile_explosion.ogg", "#Game Sounds End"].join("\n");
  const [entry] = extractSoundEntries(parseTable(text).sections);
  assert.equal(entry.name, "MV_Missile");
  assert.equal(entry.noCreate, false);
});

test("extracts +nocreate before a bare index with no filename on the line", () => {
  const text = ["#Game Sounds Start", "$Name: +nocreate\t253 ; Small turret barrel elevation", "+Entry: smallturret_elev.ogg", "#Game Sounds End"].join(
    "\n",
  );
  const [entry] = extractSoundEntries(parseTable(text).sections);
  assert.equal(entry.name, "253");
  assert.equal(entry.noCreate, true);
});
