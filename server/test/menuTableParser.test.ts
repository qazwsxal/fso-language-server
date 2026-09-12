import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseMenuTable } from "../src/menuTableParser";

test("parses a real Solaris/Star Fox Event Horizon-shape [TRAINING MENU] section with no diagnostics", () => {
  const text = [
    "; comment banner before the first section is never read by any caller - not an error",
    "",
    "[MAIN HALL]",
    "mainhall1 mainhall1-m",
    ";i:\\projects\\freespace\\music\\waves\\main.wav",
    "",
    '"" 0  NULL NULL NULL NULL',
    "",
    '"" 1 B NULL NULL NULL NULL',
    "",
    "[TRAINING MENU]",
    "trainhall trainhall-m",
    '"start" 1 S cool.abm still.pcx vibrate.abm final.abm',
    '"quit" 2 Q cool.abm still.pcx vibrate.abm final.abm',
  ].join("\n");
  const diagnostics = parseMenuTable(text);
  assert.deepEqual(diagnostics, []);
});

test("flags a menu section header missing its closing ']'", () => {
  const text = ["[TRAINING MENU", "bg mask", '"start" 1 S'].join("\n");
  const diagnostics = parseMenuTable(text);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].severity, "error");
  assert.match(diagnostics[0].message, /missing its closing "\]"/);
});

test("flags a region line missing its closing quote", () => {
  const text = ["[TRAINING MENU]", "bg mask", '"start 1 S'].join("\n");
  const diagnostics = parseMenuTable(text);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].severity, "error");
  assert.match(diagnostics[0].message, /missing its closing '"'/);
});

test("flags a region line missing its mask number and/or hotkey character", () => {
  const text = ["[TRAINING MENU]", "bg mask", '"start" 1'].join("\n");
  const diagnostics = parseMenuTable(text);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0].message, /needs a mask number and a hotkey character/);
});

test("flags a region line whose mask number isn't an integer", () => {
  const text = ["[TRAINING MENU]", "bg mask", '"start" notanumber S'].join("\n");
  const diagnostics = parseMenuTable(text);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0].message, /is not an integer/);
});

test("flags a menu's background/mask filenames line when it has fewer than two filenames", () => {
  const text = ["[TRAINING MENU]", "onlyone", '"start" 1 S'].join("\n");
  const diagnostics = parseMenuTable(text);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0].message, /needs two filenames/);
});

test("does not flag trailing unread columns on a region line (anim_start/anim_selected/anim_static/anim_leave are real but never read by read_menu_tbl())", () => {
  const text = ["[TRAINING MENU]", "bg mask", '"start" 1 S cool.abm still.pcx vibrate.abm final.abm'].join("\n");
  const diagnostics = parseMenuTable(text);
  assert.deepEqual(diagnostics, []);
});

test("warns (not errors) about an unexpected extra background/mask-shaped line appearing after the first one in a section", () => {
  const text = ["[TRAINING MENU]", "bg mask", "second unexpected", '"start" 1 S'].join("\n");
  const diagnostics = parseMenuTable(text);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].severity, "warning");
  assert.match(diagnostics[0].message, /Unexpected extra background\/mask filenames line/);
});

test("a ';' truncates the rest of a line even inside quoted text - matches real FSO's plain, non-quote-aware strchr(), not the main table grammar's quote-aware comment stripping", () => {
  const text = ["[TRAINING MENU]", "bg mask", '"start; oops" 1 S'].join("\n");
  const diagnostics = parseMenuTable(text);
  // The ';' truncates to '"start', leaving an unterminated quote - a real, if
  // unfortunate, consequence of read_menu_tbl()'s crude comment stripping.
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0].message, /missing its closing '"'/);
});

test("content before the first section header is silently ignored, not flagged (no caller ever reads it)", () => {
  const text = ["not a section, not a region, just stray text", "[TRAINING MENU]", "bg mask", '"start" 1 S'].join("\n");
  const diagnostics = parseMenuTable(text);
  assert.deepEqual(diagnostics, []);
});
