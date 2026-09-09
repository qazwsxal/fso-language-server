import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseTable } from "../src/parser";
import { extractMissionEntries } from "../src/tableAnalysis/missionEntries";

test("extracts $Class: from #Objects as a single ship-class ref per ship", () => {
  const text = [
    "#Objects",
    "",
    "$Name: Alpha 1",
    "$Class: GTF Pegasus",
    "$Team: Friendly",
    "",
    "$Name: Beta 1",
    "$Class: GVF Thoth",
    "$Team: Friendly",
    "",
    "#End",
  ].join("\n");
  const { sections } = parseTable(text);
  const entries = extractMissionEntries(sections);
  assert.deepEqual(
    entries.shipClassRefs.map((r) => `${r.line}:${r.value}`),
    ["3:GTF Pegasus", "7:GVF Thoth"],
  );
});

test("extracts +Primary Banks:/+Secondary Banks: under #Objects as weapon name refs", () => {
  const text = [
    "#Objects",
    "$Name: Alpha 1",
    "$Class: GTF Pegasus",
    '+Primary Banks: ( "Mekhu HL-7" )',
    '+Secondary Banks: ( "Tornado" )',
    "#End",
  ].join("\n");
  const { sections } = parseTable(text);
  const entries = extractMissionEntries(sections);
  assert.deepEqual(
    entries.weaponBankRefs.map((r) => `${r.line}:${r.name}`),
    ["3:Mekhu HL-7", "4:Tornado"],
  );
});

test("extracts $Ship Choices: under #Players, ignoring the pilot-select counts, one ref per real physical line even across a multi-line list", () => {
  const text = [
    "#Players",
    "",
    "$Starting Shipname: Alpha 1",
    "$Ship Choices: (",
    '\t"GTF Ulysses"\t5',
    '\t"GTF Hercules"\t5',
    '\t"GTF Ares"\t5',
    ")",
    "",
    "#End",
  ].join("\n");
  const { sections } = parseTable(text);
  const entries = extractMissionEntries(sections);
  // Lines: 0=#Players 1=(blank) 2=$Starting 3=$Ship Choices: ( 4=Ulysses 5=Hercules 6=Ares 7=)
  assert.deepEqual(
    entries.shipChoiceRefs.map((r) => `${r.line}:${r.name}`),
    ["4:GTF Ulysses", "5:GTF Hercules", "6:GTF Ares"],
  );
});

test("extracts +Weaponry Pool: under #Players the same way", () => {
  const text = [
    "#Players",
    "$Starting Shipname: Alpha 1",
    "+Weaponry Pool: (",
    '\t"Subach HL-7"\t17',
    '\t"Tempest"\t500',
    ")",
    "#End",
  ].join("\n");
  const { sections } = parseTable(text);
  const entries = extractMissionEntries(sections);
  assert.deepEqual(
    entries.weaponryPoolRefs.map((r) => `${r.line}:${r.name}`),
    ["3:Subach HL-7", "4:Tempest"],
  );
});

test("does not attribute #Objects/#Players fields to each other, or to fields outside those sections", () => {
  const text = [
    "#Mission Info",
    "$Name: Some Mission",
    "#End",
    "",
    "#Objects",
    "$Name: Alpha 1",
    "$Class: GTF Pegasus",
    "#End",
    "",
    "#Players",
    "$Starting Shipname: Alpha 1",
    "#End",
  ].join("\n");
  const { sections } = parseTable(text);
  const entries = extractMissionEntries(sections);
  assert.equal(entries.shipClassRefs.length, 1);
  assert.equal(entries.shipChoiceRefs.length, 0);
  assert.equal(entries.weaponryPoolRefs.length, 0);
  assert.equal(entries.weaponBankRefs.length, 0);
});
