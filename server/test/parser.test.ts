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

test("closes a table-specific Begin/end section pair (real lightning.tbl shape: #Bolts begin/#Bolts end)", () => {
  const text = ["#Bolts begin", "$Bolt: b_standard", "+b_scale: 0.5", "#Bolts end"].join("\n");
  const result = parseTable(text);
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].name, "Bolts begin");
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

test("closes a PREFIX-style #End <Name> section (real lighting_profiles.tbl grammar: #Profiles / #END PROFILES)", () => {
  const text = ["#Profiles", "$Profile: Default Profile", "$Exposure: 1.25", "#END PROFILES"].join("\n");
  const result = parseTable(text);
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].name, "Profiles");
  assert.equal(result.sections[0].endLine, 3);
  assert.equal(result.diagnostics.length, 0);
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

test("strips a leading UTF-8 BOM so it doesn't hide the first line's #Section header", () => {
  const text = "﻿#SPECIES DEFS\n$Species_Name: Terran\n#END";
  const result = parseTable(text);
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].name, "SPECIES DEFS");
  assert.equal(result.sections[0].entries[0].value, "Terran");
  assert.ok(!result.diagnostics.some((d) => /appears outside of any #Section block/.test(d.message)));
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
  // `line` must point at the field's own "$Flags:" line (2), NOT the last line its value
  // consumes (4, the closing ")") - a real, previously-undiscovered bug where every
  // multi-line-value branch reassigned the loop's `i` before the entry was pushed, so
  // `line: i` captured the wrong end of the span. `endLine` is the new field that
  // exposes the true last-consumed line, for anything (e.g. a "move this field" quick
  // fix) that needs the whole span rather than just where it starts.
  assert.equal(flags!.line, 2);
  assert.equal(flags!.endLine, 4);
});

test("a single-line field's line and endLine are the same", () => {
  const text = ["#Armor Type", "$Name: Light Armor", "#End"].join("\n");
  const result = parseTable(text);
  const nameEntry = result.sections[0].entries[0];
  assert.equal(nameEntry.line, 1);
  assert.equal(nameEntry.endLine, 1);
});

test("a Lua chunk field's endLine is its real closing bracket's line, not its opening line", () => {
  const text = [
    "#Conditional Hooks",
    "$On Key Pressed: [",
    "  if mn.getMissionTime() >= 1 then",
    "    AbsoluteKeys.add(hv.Key)",
    "  end",
    "]",
    "#End",
  ].join("\n");
  const result = parseTable(text);
  const entry = result.sections[0].entries.find((e) => e.key === "On Key Pressed");
  assert.ok(entry);
  assert.equal(entry!.line, 1);
  assert.equal(entry!.endLine, 5);
});

test("a multitext field's endLine includes the consumed $end_multi_text sentinel line", () => {
  const text = [
    "#Ship Classes",
    "$Name: GTF Ulysses",
    "+Description:",
    "A sturdy fighter.",
    "Built for combat.",
    "$end_multi_text",
    "#End",
  ].join("\n");
  const result = parseTable(text);
  const entry = result.sections[0].entries.find((e) => e.key === "Description");
  assert.ok(entry);
  assert.equal(entry!.line, 2);
  assert.equal(entry!.endLine, 5);
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

test("consumes a bare, sigil-less parenthesized vec3d list following $Name: in a #Wing Formations section (real wing_formations-shp.tbm shape)", () => {
  const text = [
    "#Wing Formations",
    "",
    "$Name: Double Vic",
    "(( 0.50, 0.25,-0.50)",
    " (-0.50, 0.25,-0.50)",
    " ( 0.00, 1.00,-1.00)",
    " ( 0.50, 1.25,-1.50)",
    " (-0.50,-1.25,-1.50))",
    "",
    "$Name: Finger Four",
    "((-0.50,-0.25,-0.50)",
    " ( 1.50, 1.25,-1.50)",
    " ( 1.75, 1.00,-1.75)",
    " (-1.50, 1.25,-1.50)",
    " (-1.75, 1.00,-1.75))",
  ].join("\n");
  const result = parseTable(text);
  assert.equal(result.diagnostics.filter((d) => /Unrecognized line/.test(d.message)).length, 0);
  const entries = result.sections[0].entries;
  assert.equal(entries.length, 2);
  assert.ok(entries[0].value.includes("0.50, 0.25,-0.50"));
  assert.ok(entries[1].value.includes("1.75, 1.00,-1.75"));
});

test("does not treat a bare list following $Name: as a wing-formation value outside a #Wing Formations section", () => {
  const text = ["#Ship Classes", "$Name: GTF Ulysses", "(1, 2, 3)", "#End"].join("\n");
  const result = parseTable(text);
  assert.equal(result.diagnostics.filter((d) => /Unrecognized line/.test(d.message)).length, 1);
});

test("consumes a curve's bare, sigil-less '(x, y): Type' keyframe lines following $Keyframes: in a #Curves section (real Star Fox Event Horizon curves.tbl shape)", () => {
  const text = [
    "#Curves",
    "",
    "$Name: WalkerSpeedCurve",
    "$KeyFrames:",
    "(0, 0): Linear",
    "(100, 4.0): Constant",
    "(200, 5.0): Constant",
    "",
    "$Name: WalkerRunSpeedCurve",
    "$KeyFrames:",
    "(75, 0): Linear",
    "(76, 1): Constant",
    "",
    "#End",
  ].join("\n");
  const result = parseTable(text, { autoCloseSectionsOnNextSection: true, tolerateUnclosedSectionAtEof: true });
  assert.deepEqual(result.diagnostics, []);
  const entries = result.sections[0].entries;
  const keyframeEntries = entries.filter((e) => e.key === "KeyFrames");
  assert.equal(keyframeEntries.length, 2);
  assert.ok(keyframeEntries[0].value.includes("(200, 5.0): Constant"));
  assert.ok(keyframeEntries[1].value.includes("(76, 1): Constant"));
});

test("does not treat a bare '(x, y): Type' line as a curve keyframe outside a #Curves section", () => {
  const text = ["#Ship Classes", "$Name: GTF Ulysses", "$KeyFrames:", "(0, 0): Linear", "#End"].join("\n");
  const result = parseTable(text);
  assert.equal(result.diagnostics.filter((d) => /Unrecognized line/.test(d.message)).length, 1);
});

test("consumes a multi-line embedded Lua chunk in single brackets without flagging any of its lines (real scripting.tbl/-sct.tbm shape)", () => {
  const text = [
    "#Conditional Hooks",
    "",
    "$Application: FS2_Open",
    "",
    "$On Key Pressed: [",
    "  if mn.getMissionTime() >= 1 then",
    "    AbsoluteKeys.add(hv.Key)",
    "  end",
    "]",
    "",
    "#End",
  ].join("\n");
  const result = parseTable(text);
  assert.deepEqual(result.diagnostics, []);
  const entries = result.sections[0].entries;
  assert.equal(entries.length, 2);
  assert.equal(entries[1].key, "On Key Pressed");
  assert.ok(entries[1].value.includes("AbsoluteKeys.add(hv.Key)"));
});

test("finds an embedded Lua chunk's opening bracket even when a blank line separates it from its own field (real Blackwater axmsg-sct.tbm shape)", () => {
  const text = [
    "#Conditional Hooks",
    "$Application: FS2_Open",
    "",
    "$On Game Init:",
    "",
    "[",
    "",
    "axemParse = require \"axParse\"",
    "]",
    "",
    "#End",
  ].join("\n");
  const result = parseTable(text);
  assert.deepEqual(result.diagnostics, []);
  const entries = result.sections[0].entries;
  assert.equal(entries.length, 2);
  assert.equal(entries[1].key, "On Game Init");
  assert.ok(entries[1].value.includes('axemParse = require "axParse"'));
});

test("consumes a same-line, single-line embedded Lua chunk", () => {
  const text = ["#Conditional Hooks", "$On Gameplay Start: [ AbsoluteKeys.reset() ]", "#End"].join("\n");
  const result = parseTable(text);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.sections[0].entries[0].value, "[ AbsoluteKeys.reset() ]");
});

test("consumes a double-bracket external Lua filename reference", () => {
  const text = ["#Global Hooks", "$Global: [[data/scripts/my_hooks.lua]]", "#End"].join("\n");
  const result = parseTable(text);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.sections[0].entries[0].value, "[[data/scripts/my_hooks.lua]]");
});

test("reports an error (not silent EOF-swallowing) for a Lua chunk missing its closing bracket", () => {
  // The unclosed chunk also swallows the real "#End" below while searching for its own
  // close (matching what FSO's own alloc_block()/required_string("#End") sequence would
  // do too - it never gets there either), so the enclosing section is left unclosed as
  // well; both diagnostics are genuine, not a bug in this test's expectations.
  const text = ["#Conditional Hooks", "$On Key Pressed: [", "  do_something()", "#End"].join("\n");
  const result = parseTable(text);
  assert.equal(result.diagnostics.length, 2);
  assert.ok(result.diagnostics.some((d) => /never closed with a matching/.test(d.message) && d.severity === "error"));
  assert.ok(result.diagnostics.some((d) => /was never closed with #End/.test(d.message)));
});

test("warns about a bare ';' inside an embedded Lua chunk silently truncating the rest of the line (real FSO strip_comments() footgun)", () => {
  const text = ["#Conditional Hooks", "$On Key Pressed: [", "  local x = 5; local y = 10", "]", "#End"].join("\n");
  const result = parseTable(text);
  const footguns = result.diagnostics.filter((d) => /silently discarded when this table loads/.test(d.message));
  assert.equal(footguns.length, 1);
  assert.equal(footguns[0].severity, "warning");
  assert.equal(footguns[0].line, 2);
  // The captured value still only contains what FSO's own engine would actually keep -
  // "local y = 10" is genuinely gone, matching real (if unfortunate) engine behavior;
  // the diagnostic above is what tells the user their code was silently cut.
  assert.ok(!result.sections[0].entries[0].value.includes("local y = 10"));
});

test("does not warn about a whole-line ';; comment' with nothing but whitespace before it (real The Sixth Seal proBox-sct.tbm shape: a plain double-semicolon note, not a version tag, cutting off no real code)", () => {
  const text = [
    "#Conditional Hooks",
    "$On Key Pressed: [",
    ";; In 21.4, addBit was deprecated and replaced with setBit",
    "  data.Bitfield = bit.addBit(data.Bitfield, value)",
    "]",
    "#End",
  ].join("\n");
  const result = parseTable(text);
  const footguns = result.diagnostics.filter((d) => /silently discarded when this table loads/.test(d.message));
  assert.equal(footguns.length, 0);
});

test("does not warn about a trailing Lua statement-terminator ';' with nothing but whitespace after it (real Star Fox Event Horizon mainmenumovie-sct.tbm shape: 'lastTime = currentTime;' with nothing left on the line to lose)", () => {
  const text = ["#Conditional Hooks", "$On Key Pressed: [", "  lastTime = currentTime;", "]", "#End"].join("\n");
  const result = parseTable(text);
  const footguns = result.diagnostics.filter((d) => /silently discarded when this table loads/.test(d.message));
  assert.equal(footguns.length, 0);
});

test("does not warn about a ';' inside a Lua double-quoted string (FSO's own quote-toggle already protects this case)", () => {
  const text = ["#Conditional Hooks", "$On Key Pressed: [", '  local s = "a;b"', "]", "#End"].join("\n");
  const result = parseTable(text);
  assert.deepEqual(result.diagnostics, []);
});

test("does not warn about a ';' that's already inside a Lua '--' line comment (real BtA flickerships-sct.tbm/movements-sct.tbm shape: old commented-out code ending in a stray ';')", () => {
  const text = [
    "#Conditional Hooks",
    "$On Key Pressed: [",
    "  break; -- normal Lua, no comment",
    "  -- vm_vec_normalize(&v1);	--normalize fvec of me",
    "]",
    "#End",
  ].join("\n");
  const result = parseTable(text);
  const footguns = result.diagnostics.filter((d) => /silently discarded when this table loads/.test(d.message));
  // Line index 2 ("break; -- ...") has its ';' BEFORE the "--", so it's still reported
  // (real code, even though nothing follows here in this example). Line index 3's ';'
  // comes AFTER its line's own "--", i.e. inside an already-inert Lua comment, so it's
  // silently skipped - both real shapes, confirmed against real Between the Ashes
  // scripts.
  assert.deepEqual(
    footguns.map((d) => d.line),
    [2],
  );
});

test("warns about a self-contained '/*'..'*/' sequence inside an embedded Lua chunk risking silently eaten code", () => {
  // The "*/" closes the comment on the same line, so the chunk's own "]" below survives
  // stripBlockComments() intact and this hits the per-line footgun check specifically
  // (not the "chunk looks unclosed" case covered by the test below).
  const text = ["#Conditional Hooks", "$On Key Pressed: [", "  local half = a/*b*/c -- oops, not real Lua", "]", "#End"].join(
    "\n",
  );
  const result = parseTable(text);
  const footguns = result.diagnostics.filter((d) => /start of a comment anywhere in the file/.test(d.message));
  assert.equal(footguns.length, 1);
  assert.equal(footguns[0].severity, "warning");
});

test("uses softer wording for a ';;FSO x.y.z;;'-gated block comment inside a Lua chunk (real Warmachine mv_dbrs-sct.tbm shape - an intentional version-conditional comment, not a mistake)", () => {
  const text = [
    "#Conditional Hooks",
    "$On Game Init: [",
    "  -- functions for later sections",
    "",
    ";;FSO 20.1.0.20200831;; !*",
    "  function get_rnd_vector_sphere() end",
    ";;FSO 20.1.0.20200831;; *!",
    "]",
    "#End",
  ].join("\n");
  const result = parseTable(text);
  const footguns = result.diagnostics.filter((d) => /start of a comment anywhere in the file/.test(d.message));
  const versionGated = result.diagnostics.filter((d) => /version-tag-gated comment block/.test(d.message));
  assert.equal(footguns.length, 0);
  assert.equal(versionGated.length, 1);
  assert.equal(versionGated[0].severity, "warning");
});

test("does not mistake a ';;FSO x.y.z;;' version tag's own double-semicolons for a bare-';' footgun (real Warmachine mv_dbrs-sct.tbm shape: a whole line prefixed with a version tag to make it version-conditional)", () => {
  const text = [
    "#Conditional Hooks",
    "$On Debris Created: [",
    ";;FSO 20.1.0.20200731;; \tif not mediavps.debrisOverride then",
    ";;FSO 20.1.0.20200731;; \t\tlocal debr = mediavps.MV_Debris",
    ";;FSO 20.1.0.20200731;; \tend",
    "]",
    "#End",
  ].join("\n");
  const result = parseTable(text);
  assert.deepEqual(result.diagnostics, []);
});

test("gives a specific diagnostic when a '/*'/'!*' sequence swallows a Lua chunk's real closing bracket, instead of a generic 'unclosed' error", () => {
  const text = ["#Conditional Hooks", "$On Key Pressed: [", "  local half = a/*b -- oops, not real Lua", "]", "#End"].join(
    "\n",
  );
  const result = parseTable(text);
  // Also leaves the enclosing "#Conditional Hooks" section unclosed, since its real
  // "#End" got swallowed right along with the chunk's closing bracket - see the
  // "reports an error... missing its closing bracket" test above for the same pattern.
  assert.equal(result.diagnostics.length, 2);
  const culprit = result.diagnostics.find((d) => /consumed the rest of this Lua chunk/.test(d.message));
  assert.ok(culprit);
  assert.equal(culprit!.severity, "error");
  assert.equal(culprit!.line, 2);
});

test("warns when a bracket inside a Lua string desyncs FSO's naive bracket counting from where the Lua code actually ends", () => {
  const text = [
    "#Conditional Hooks",
    "$On Key Pressed: [",
    "  local s = ']'", // a lone ']' inside a Lua string - FSO's naive scan closes the chunk right here
    "  do_the_real_work()",
    "]",
    "#End",
  ].join("\n");
  const result = parseTable(text);
  const footguns = result.diagnostics.filter((d) => /close it somewhere different/.test(d.message));
  assert.equal(footguns.length, 1);
  assert.equal(footguns[0].severity, "warning");
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

test("strips a single wrapping quote pair from a plain single-line value (real bp-main-hall.tbm $Species: shape)", () => {
  const text = ["#Ship Classes", '$Species: "Terran"', "#End"].join("\n");
  const result = parseTable(text);
  assert.equal(result.sections[0].entries[0].value, "Terran");
});

test("does not strip quotes from a parenthesized list value, or from a value that merely starts with a quote (XSTR-style)", () => {
  const text = [
    "#Ship Classes",
    '$Flags: ( "player allowed" "in tech database" )',
    '+Title: XSTR( "Some text", -1 )',
    "#End",
  ].join("\n");
  const result = parseTable(text);
  assert.equal(result.sections[0].entries[0].value, '( "player allowed" "in tech database" )');
  assert.equal(result.sections[0].entries[1].value, 'XSTR( "Some text", -1 )');
});

test("autoCloseSectionsOnNextSection: a section is closed silently by the next #Section header, no explicit #End needed (real messages.tbl #Personas/#Messages shape)", () => {
  const text = [
    "#Personas",
    "$Persona: Terran Command",
    "+Flags: ( \"Wingman\" )",
    "#Messages",
    "$Name: M01",
    "$Message: XSTR(\"Hello\", -1)",
    "#End",
  ].join("\n");
  const result = parseTable(text, { autoCloseSectionsOnNextSection: true });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.sections.length, 2);
  assert.equal(result.sections[0].name, "Personas");
  assert.equal(result.sections[0].endLine, 2);
  assert.equal(result.sections[1].name, "Messages");
  assert.equal(result.sections[1].endLine, 6);
});

test("autoCloseSectionsOnNextSection: seven chained bare-divider sections all close implicitly, only the trailing #END is real (real The Sixth Seal 2 tss2-mod.tbm game_settings.tbl/*-mod.tbm shape)", () => {
  const text = [
    "#GAME SETTINGS",
    "$Unicode mode: YES",
    "#CAMPAIGN SETTINGS",
    "$Default Campaign File Name: tss2",
    "#Ignored Campaign File Names",
    "$Campaign File Name: tss",
    "#Ignored Mission File Names",
    "$Mission File Name: mdu-02",
    "#SEXP SETTINGS",
    "#GRAPHICS SETTINGS",
    "#OTHER SETTINGS",
    "$Fixed Turret Collisions: YES",
    "#END",
  ].join("\n");
  const result = parseTable(text, { autoCloseSectionsOnNextSection: true });
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.sections.length, 7);
  assert.equal(result.sections[6].name, "OTHER SETTINGS");
  assert.equal(result.sections[6].endLine, 12);
});

test("autoCloseSectionsOnNextSection: the very LAST section still needs a real #End (only the boundary BETWEEN sections is implicit)", () => {
  const text = ["#Personas", "$Persona: Terran Command", "#Messages", "$Name: M01"].join("\n");
  const result = parseTable(text, { autoCloseSectionsOnNextSection: true });
  assert.equal(result.diagnostics.length, 1);
  assert.match(result.diagnostics[0].message, /Messages.*was never closed with #End/);
});

test("without autoCloseSectionsOnNextSection (the default), the same file reports the earlier section as not closed - confirms the option isn't accidentally on for every table", () => {
  const text = ["#Personas", "$Persona: Terran Command", "#Messages", "$Name: M01", "#End"].join("\n");
  const result = parseTable(text);
  assert.equal(result.diagnostics.length, 1);
  assert.match(result.diagnostics[0].message, /Personas.*was not closed with #End before the next section started/);
});

test("tolerateUnclosedSectionAtEof: a section still open when the file ends is not reported at all (real traitor.tbl shape: neither section ever closes, not even the last one)", () => {
  const text = [
    "#Debriefing_info",
    "$Voice: bta_trtr_db.ogg",
    "#Traitor Overrides",
    "$Name: Admiral Po",
    "$Voice Filename: 100_bta_trtr_db.ogg",
  ].join("\n");
  const result = parseTable(text, { autoCloseSectionsOnNextSection: true, tolerateUnclosedSectionAtEof: true });
  assert.deepEqual(result.diagnostics, []);
});

test("freeTextAfterKnownLeadingFields: known leading fields still parse normally, then free-form scroll text produces no diagnostics at all (real credits.tbl shape)", () => {
  const knownFields = new Set(["text scroll rate", "scp credits position"]);
  const text = [
    "$Text scroll rate: 1.0",
    "$SCP Credits position: End",
    "-----------------------------------------",
    'XSTR("THANKS AND ACKNOWLEDGMENTS", 510)',
    "-----------------------------------------",
    "",
    'XSTR("Some Contributor", 511)',
    "#not a real section, just credits text that happens to start with #",
  ].join("\n");
  const creditsResult = parseTable(text, { freeTextAfterKnownLeadingFields: knownFields });
  // credits.tbl genuinely has no #Section header (confirmed against real FSO source and
  // mod files), so this is the same loose-catch-all "outside of any #Section block"
  // warning covered by rank.tbl's test above - not a false positive from this option.
  assert.equal(creditsResult.diagnostics.length, 1);
  assert.match(creditsResult.diagnostics[0].message, /appears outside of any #Section block/);
  assert.equal(creditsResult.sections[0].entries.length, 2);
  assert.equal(creditsResult.sections[0].entries[0].key, "Text scroll rate");
  assert.equal(creditsResult.sections[0].entries[1].key, "SCP Credits position");
});

test("freeTextAfterKnownLeadingFields: an empty set switches to free text immediately, on line 1 (real credits-footer.tbl shape)", () => {
  const text = ["---------------------------------------------------", 'XSTR("THANKS FOR PLAYING!", 9314)', "---"].join(
    "\n",
  );
  const footerResult = parseTable(text, { freeTextAfterKnownLeadingFields: new Set() });
  assert.deepEqual(footerResult.diagnostics, []);
  assert.equal(footerResult.sections.length, 0);
});

test("allowBareIndexedStrings: a bare '<index>, \"<string>\"' line (no sigil) is recognized instead of flagged as unrecognized (real strings.tbl/tstrings.tbl shape - FSO's stuff_int() explicitly consumes the trailing comma)", () => {
  const text = [
    "#default",
    '0, "Player ship changed to %s"',
    '1, "Changed player target to %s"',
    '2 "Another string, no comma variant" 0 0',
    '-3 "A negative index is still valid"',
    "#German",
    '1, "Ein String"',
  ].join("\n");
  const stringsResult = parseTable(text, {
    allowBareIndexedStrings: true,
    autoCloseSectionsOnNextSection: true,
    tolerateUnclosedSectionAtEof: true,
  });
  assert.deepEqual(stringsResult.diagnostics, []);
});

test("allowBareIndexedStrings: a multi-line string's closing quote is still found even when a continuation line contains a bare ';' (real SCPUI-0.9.0 tstrings.tbl shape - FSO's real strip_comments() tracks its in_quote flag across the whole file, so a ';' inside a still-open string never starts a comment)", () => {
  const text = [
    "#default",
    '172, "Notruf',
    "",
    "Hier ein Teil seiner Übertragung; wir haben die Mitteilung bearbeitet.",
    "",
    'Granitberg, hier Schwarze Taube. Setze Pharosbojen aus, um Suche zu erleichtern."',
    "",
    '173, "Der Rückzug der Allianz"',
  ].join("\n");
  const result = parseTable(text, {
    allowBareIndexedStrings: true,
    autoCloseSectionsOnNextSection: true,
    tolerateUnclosedSectionAtEof: true,
  });
  assert.deepEqual(result.diagnostics, []);
});

test("allowBareIndexedStrings: without the option, the same content is flagged as unrecognized (confirms the option isn't accidentally on for every table)", () => {
  const text = ["#default", '1 "Some string" 0 0'].join("\n");
  const withoutOptionResult = parseTable(text, { autoCloseSectionsOnNextSection: true, tolerateUnclosedSectionAtEof: true });
  assert.equal(withoutOptionResult.diagnostics.length, 1);
  assert.match(withoutOptionResult.diagnostics[0].message, /Unrecognized line/);
});

test("allowBareKeyValueLines: a bare 'Key: value' line (no sigil) nested inside a real +Custom: block is recognized instead of flagged (real hud_gauges.tbl/bta-hdg.tbm shape)", () => {
  const text = [
    "#Gauge Config",
    "$Name: BtA Custom Gauges",
    "+Custom:",
    "	Origin: (0.5, 0.13)",
    "	Offset: (-270, 0)",
    '	Text: XSTR("", -1)',
    "	X Offset: 10",
    "	Active by default: NO",
    "#End",
  ].join("\n");
  const gaugesResult = parseTable(text, { allowBareKeyValueLines: true });
  assert.deepEqual(gaugesResult.diagnostics, []);
});

test("allowBareKeyValueLines: a bare key starting with a digit (e.g. '3 Digit Hull Offsets:') is recognized too (real Blue Planet Complete mv_root-hdg.tbm shape)", () => {
  const text = [
    "#Gauge Config",
    "+Custom:",
    "	Origin: (0.5, 0.5)",
    "	3 Digit Hull Offsets: (6,12)",
    "	2 Digit Hull Offsets: (14,12)",
    "	1 Digit Hull Offsets: (19,12)",
    "#End",
  ].join("\n");
  const result = parseTable(text, { allowBareKeyValueLines: true });
  assert.deepEqual(result.diagnostics, []);
});

test("recognizes traitor.tbl's $Multi text:/$Recommendation text: as multi-line fields, not their XSTR content as unrecognized lines (real Between the Ashes traitor.tbl shape)", () => {
  const text = [
    "#Debriefing_info",
    "$Multi text:",
    '   XSTR("Some long debriefing text.", 1548)',
    "$end_multi_text",
    "$Voice: bta_trtr_db.ogg",
    "$Recommendation text:",
    '   XSTR("Friendly ships are not valid targets.", 1549)',
    "$end_multi_text",
    "#Traitor Overrides",
    "$Name: Admiral Po",
    '$Text: XSTR("Some long override text.", 1548)',
    "$end_multi_text",
    "$Voice Filename: 100_bta_trtr_db.ogg",
    "$Recommendation text:",
    '   XSTR("Friendly ships are not valid targets.", 1549)',
    "$end_multi_text",
  ].join("\n");
  const result = parseTable(text, { autoCloseSectionsOnNextSection: true, tolerateUnclosedSectionAtEof: true });
  assert.deepEqual(result.diagnostics, []);
});
