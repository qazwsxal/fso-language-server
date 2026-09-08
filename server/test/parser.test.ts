import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseTable, LOOSE_SECTION_NAME } from "../src/parser";

test("strips a slash-star block comment within a single line", () => {
  const text = ["#Armor Type", "$Name: Light /* cosmetic note */ Armor", "#End"].join("\n");
  const result = parseTable(text);
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].entries.length, 1);
  assert.equal(result.sections[0].entries[0].value, "Light  Armor");
});

test("a block comment spanning multiple lines removes its content but keeps line numbers intact for what follows", () => {
  // Newlines inside the comment span are deliberately preserved (not collapsed), so
  // diagnostics/positions for every subsequent line stay accurate - a design tradeoff
  // over exactly mirroring the real engine's byte-stream comment stripping.
  const text = ["#Armor Type", "$Name: Light /* this is", "a comment */Armor", "#End"].join("\n");
  const result = parseTable(text);
  assert.equal(result.sections[0].entries[0].value, "Light");
  assert.equal(result.sections[0].entries[0].line, 1);
  assert.ok(result.diagnostics.some((d) => d.line === 2 && /Unrecognized line/.test(d.message)));
});

test("strips bang-star block comments distinctly from slash-star", () => {
  const text = ["#Armor Type", "$Name: !* comment *! Heavy", "#End"].join("\n");
  const result = parseTable(text);
  assert.equal(result.sections[0].entries[0].value, "Heavy");
});

test("does not close a bang-star comment with a slash-star closer or vice versa", () => {
  const text = ["#Armor Type", "$Name: !* a /* nested-looking */ still open *! Heavy", "#End"].join("\n");
  const result = parseTable(text);
  assert.equal(result.sections[0].entries[0].value, "Heavy");
});

test("strips a leading version tag but keeps the rest of the line as live content", () => {
  const text = ["#Armor Type", ';;FSO 3.7.2;; $Name: NewArmor', "#End"].join("\n");
  const result = parseTable(text);
  assert.equal(result.sections[0].entries.length, 1);
  assert.equal(result.sections[0].entries[0].key, "Name");
  assert.equal(result.sections[0].entries[0].value, "NewArmor");
});

test("closes a table-specific Start/End section pair, not just generic #End", () => {
  const text = ["#Game Sounds Start", "$Name: 1", "+Filename: boop.ogg", "#Game Sounds End"].join("\n");
  const result = parseTable(text);
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].name, "Game Sounds Start");
  assert.equal(result.sections[0].endLine, 3);
  assert.equal(result.diagnostics.length, 0);
});

test("a plain #End still closes a Start/End-style section (defensive fallback)", () => {
  const text = ["#Game Sounds Start", "$Name: 1", "#End"].join("\n");
  const result = parseTable(text);
  assert.equal(result.sections[0].endLine, 2);
});

test("does not let an unrelated section's close token close a different table-specific section", () => {
  const text = ["#Game Sounds Start", "$Name: 1", "#Interface Sounds End"].join("\n");
  const result = parseTable(text);
  // "#Interface Sounds End" matches neither "#Game Sounds End" (this section's own close
  // token) nor the generic "#End", so it does NOT close "Game Sounds Start" - it's
  // instead treated as a new (malformed) section header, with a diagnostic flagging that
  // the first section was never closed.
  assert.equal(result.sections[0].name, "Game Sounds Start");
  assert.equal(result.sections[0].endLine, null);
  assert.ok(result.diagnostics.some((d) => /was not closed with #End/.test(d.message)));
});

test("scans a known multitext field (+Description:) forward to its $end_multi_text sentinel", () => {
  const text = [
    "#Ship Classes",
    "$Name: GTF Ulysses",
    "+Description:",
    "A sturdy fighter.",
    "Built for combat.",
    "$end_multi_text",
    "+Tech Title: Ulysses",
    "#End",
  ].join("\n");
  const result = parseTable(text);
  const entries = result.sections[0].entries;
  const description = entries.find((e) => e.key === "Description");
  assert.ok(description);
  assert.equal(description!.value, "A sturdy fighter.\nBuilt for combat.");
  const techTitle = entries.find((e) => e.key === "Tech Title");
  assert.ok(techTitle);
  assert.equal(techTitle!.value, "Ulysses");
});

test("does not treat an ordinary bare marker field like $Trail: as a multitext scan", () => {
  const text = ["#Ship Classes", "$Name: GTF Ulysses", "$Trail:", "+Bitmap: trail01", "#End"].join("\n");
  const result = parseTable(text);
  const entries = result.sections[0].entries;
  assert.equal(entries.find((e) => e.key === "Trail")!.value, "");
  assert.equal(entries.find((e) => e.key === "Bitmap")!.value, "trail01");
});

test("captures fields with no enclosing #Section into a loose catch-all instead of discarding them (rank.tbl has no required header)", () => {
  const text = ["$Name: Cadet", "$Points: 0", "#End"].join("\n");
  const result = parseTable(text);
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].name, LOOSE_SECTION_NAME);
  assert.equal(result.sections[0].entries.length, 2);
  assert.equal(result.sections[0].entries[0].value, "Cadet");
  // Still flagged - most tables genuinely do require a #Section, this is a real warning
  // for those; rank.tbl-aware callers just also get the real data alongside it.
  assert.ok(result.diagnostics.some((d) => /appears outside of any #Section block/.test(d.message)));
});

test("silently skips a legacy [Bracket Header] line rather than flagging it as unrecognized", () => {
  const text = ["[RANK NAMES]", "$Name: Cadet", "#End"].join("\n");
  const result = parseTable(text);
  assert.equal(result.sections[0].entries[0].value, "Cadet");
  assert.ok(!result.diagnostics.some((d) => /Unrecognized line/.test(d.message)));
});

test("continues a parenthesized list value across lines with a balanced-quote opening line (real bp-wep.tbm $Flags: shape)", () => {
  // Confirmed against a real Blue Planet bp-wep.tbm: a $Flags: list can span lines where
  // the opening line's quote count is already EVEN (unlike the XSTR("... case), so only
  // an unclosed paren - not an odd quote count - signals the value isn't finished yet.
  const text = [
    "#Secondary Weapons",
    "$Name: Cluster Bomb",
    '$Flags:    ( "player allowed" ',
    '    "Spawn Cluster Baby#bomber,25"    ;; inline comment with "quotes" inside it',
    '    "Remote Detonate" )    ;; trailing comment',
    "#End",
  ].join("\n");
  const result = parseTable(text);
  const flags = result.sections[0].entries.find((e) => e.key === "Flags");
  assert.ok(flags);
  // The opening line's value is trimmed (like any other field), but continuation lines
  // are only comment-stripped, not trimmed - trailing whitespace before a stripped
  // ";;" comment is preserved, same as it would be for any other multi-line value.
  assert.equal(
    flags!.value,
    '( "player allowed"\n' + '    "Spawn Cluster Baby#bomber,25"    \n' + '    "Remote Detonate" )    ',
  );
  assert.equal(result.diagnostics.filter((d) => /Unrecognized line/.test(d.message)).length, 0);
});

test("continues a parenthesized list value across many lines even with zero quotes (real bp-wep.tbm $Player Weapon Precedence: shape)", () => {
  const text = [
    '$Player Weapon Precedence: (',
    '\t"UX Accelerator"',
    '\t"Sidhe"',
    '\t"Rapier"',
    ")",
  ].join("\n");
  const result = parseTable(text);
  const entries = result.sections[0].entries;
  assert.equal(entries.length, 1);
  assert.ok(entries[0].value.includes('"UX Accelerator"'));
  assert.ok(entries[0].value.includes('"Rapier"'));
  assert.equal(result.diagnostics.filter((d) => /Unrecognized line/.test(d.message)).length, 0);
});

test("does not keep emitting a fresh #Section warning for every field in a genuinely sectionless table (real bp-main-hall.tbm shape)", () => {
  const text = ["$Num Resolutions: 2", "$Main Hall", "+Name: BP1-Start", "+Bitmap: BP1-Mainhall640"].join("\n");
  const result = parseTable(text);
  const sectionWarnings = result.diagnostics.filter((d) => /appears outside of any #Section block/.test(d.message));
  assert.equal(sectionWarnings.length, 1);
  assert.equal(sectionWarnings[0].line, 0);
  // All four fields still land in the loose catch-all - only the diagnostic is collapsed.
  assert.equal(result.sections[0].entries.length, 4);
});

test("resumes warning after a real #Section closes and a new sectionless run starts", () => {
  const text = ["$Loose1: a", "#Armor Type", "$Name: Light", "#End", "$Loose2: b"].join("\n");
  const result = parseTable(text);
  const sectionWarnings = result.diagnostics.filter((d) => /appears outside of any #Section block/.test(d.message));
  assert.equal(sectionWarnings.length, 2);
});
