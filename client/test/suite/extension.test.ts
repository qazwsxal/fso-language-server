import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const fixturesRoot = path.resolve(__dirname, "../../../test/fixtures/mymod");

suite("FSO Table Language Server", () => {
  test("flags an unclosed #Section as an error diagnostic", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/broken.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    const diagnostics = await waitForDiagnostics(uri);
    const messages = diagnostics.map((d) => d.message);
    assert.ok(
      diagnostics.some((d) => /never closed/i.test(d.message)),
      `expected a "never closed" diagnostic, got: ${JSON.stringify(messages)}`,
    );
  });

  test("flags an out-of-order ships.tbl field as a warning", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    const diagnostics = await waitForDiagnostics(uri);
    const messages = diagnostics.map((d) => d.message);
    assert.ok(
      diagnostics.some((d) => /out of the expected field order/i.test(d.message)),
      `expected a field-order diagnostic, got: ${JSON.stringify(messages)}`,
    );
  });

  test("hover resolves $Subsystem against the mod's actual model file", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri); // ensure the server has processed this document at least once

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const matchLine = lines.findIndex((l) => l.includes("$Subsystem: engine01"));
    const mismatchLine = lines.findIndex((l) => l.includes("$Subsystem: nonexistent_part"));
    assert.ok(matchLine >= 0 && mismatchLine >= 0, "fixture must contain both subsystem lines");

    const matchHover = await getHoverText(uri, matchLine);
    assert.ok(matchHover.includes("✓"), `expected a match checkmark, got: ${matchHover}`);
    assert.ok(matchHover.includes("fighter01.pof"), `expected the resolved model filename, got: ${matchHover}`);

    const mismatchHover = await getHoverText(uri, mismatchLine);
    assert.ok(mismatchHover.includes("⚠"), `expected a no-match warning, got: ${mismatchHover}`);
    assert.ok(mismatchHover.includes("engine01"), `expected the real subsystem name to be listed, got: ${mismatchHover}`);
  });

  test("flags a $Default PBanks: count mismatch against the model's GPNT bank count", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    const diagnostics = await waitForDiagnostics(uri);
    const messages = diagnostics.map((d) => d.message);
    assert.ok(
      diagnostics.some((d) => /\$Default PBanks:.*defines 2 primary bank/i.test(d.message)),
      `expected a bank-count mismatch diagnostic, got: ${JSON.stringify(messages)}`,
    );

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const bankLine = lines.findIndex((l) => l.includes("$Default PBanks:"));
    assert.ok(bankLine >= 0, "fixture must contain a $Default PBanks: line");

    const hoverText = await getHoverText(uri, bankLine);
    assert.ok(hoverText.includes("⚠"), `expected a bank-count warning in hover, got: ${hoverText}`);
    assert.ok(hoverText.includes("model has 2"), `expected the actual model bank count in hover, got: ${hoverText}`);
  });

  test("flags an unresolvable weapon $Model File: and hovers the resolvable one", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/weapons.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    const diagnostics = await waitForDiagnostics(uri);
    const messages = diagnostics.map((d) => d.message);
    assert.ok(
      diagnostics.some((d) => /does_not_exist\.pof.*could not be resolved/i.test(d.message)),
      `expected an unresolved-model diagnostic, got: ${JSON.stringify(messages)}`,
    );

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const tempestNameLine = lines.findIndex((l) => l.includes("$Name: Tempest"));
    assert.ok(tempestNameLine >= 0, "fixture must contain a Tempest weapon entry");

    const hoverText = await getHoverText(uri, tempestNameLine);
    assert.ok(hoverText.includes("fighter01.pof"), `expected the resolved model filename, got: ${hoverText}`);
    assert.ok(hoverText.includes("✓"), `expected a found checkmark, got: ${hoverText}`);
    assert.ok(hoverText.includes("subobject"), `expected a POF summary, got: ${hoverText}`);
  });

  test("flags a ship $Armor Type: that doesn't exist in armor.tbl", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    const diagnostics = await waitForDiagnostics(uri);
    const messages = diagnostics.map((d) => d.message);
    assert.ok(
      diagnostics.some((d) => /\$Armor Type:.*"Nonexistent Armor".*was not found in armor\.tbl/i.test(d.message)),
      `expected an unresolved armor-type diagnostic, got: ${JSON.stringify(messages)}`,
    );

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const armorLine = lines.findIndex((l) => l.includes("$Armor Type:"));
    assert.ok(armorLine >= 0, "fixture must contain a $Armor Type: line");

    const hoverText = await getHoverText(uri, armorLine);
    assert.ok(hoverText.includes("⚠"), `expected an armor-type warning in hover, got: ${hoverText}`);
  });

  test("validates ship texture fields against what's actually on the mod's search path", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    const diagnostics = await waitForDiagnostics(uri);
    const messages = diagnostics.map((d) => d.message);
    assert.ok(
      diagnostics.some((d) => /Ship_anim.*"nonexistent_anim".*not found/i.test(d.message)),
      `expected a texture-not-found diagnostic for Ship_anim, got: ${JSON.stringify(messages)}`,
    );
    assert.ok(
      !diagnostics.some((d) => /Ship_icon.*not found/i.test(d.message)),
      `did not expect a diagnostic for the real Ship_icon texture, got: ${JSON.stringify(messages)}`,
    );

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const iconLine = lines.findIndex((l) => l.includes("$Ship_icon:"));
    const animLine = lines.findIndex((l) => l.includes("$Ship_anim:"));
    assert.ok(iconLine >= 0 && animLine >= 0, "fixture must contain both $Ship_icon: and $Ship_anim: lines");

    const iconHover = await getHoverText(uri, iconLine);
    assert.ok(iconHover.includes("✓"), `expected the real texture to be found, got: ${iconHover}`);

    const animHover = await getHoverText(uri, animLine);
    assert.ok(animHover.includes("⚠"), `expected the missing texture to be flagged, got: ${animHover}`);
  });

  test("finds textures packed inside a .vpc archive, not just .vp", async () => {
    // Regression test: a real MediaVPs-style install ships its assets in .vpc archives
    // (same VP container format, just a different extension - some entries' payloads
    // may be LZ41-compressed, but that never affects the directory/index listing this
    // relies on). The texture index only scanned ".vp" and silently missed every
    // texture in any ".vpc" archive on the search path - confirmed against a real
    // Blue Planet install where three whole dependency mods' assets ship exclusively
    // as .vpc and were invisible to the "not found" check.
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    const diagnostics = await waitForDiagnostics(uri);
    const messages = diagnostics.map((d) => d.message);
    assert.ok(
      !diagnostics.some((d) => /Ship_overhead.*not found/i.test(d.message)),
      `did not expect a diagnostic for the .vpc-packed texture, got: ${JSON.stringify(messages)}`,
    );

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const overheadLine = lines.findIndex((l) => l.includes("$Ship_overhead:"));
    assert.ok(overheadLine >= 0, "fixture must contain a $Ship_overhead: line");

    const hoverText = await getHoverText(uri, overheadLine);
    assert.ok(hoverText.includes("✓"), `expected the .vpc-packed texture to be found, got: ${hoverText}`);
  });

  test("cross-validates weapons.tbl $Damage Type: against armor.tbl's +Damage Type: entries", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/weapons.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    const diagnostics = await waitForDiagnostics(uri);
    const messages = diagnostics.map((d) => d.message);
    assert.ok(
      diagnostics.some((d) => /\$Damage Type:.*"Plasma".*not referenced by any armor\.tbl/i.test(d.message)),
      `expected an unreferenced damage-type diagnostic, got: ${JSON.stringify(messages)}`,
    );
    assert.ok(
      !diagnostics.some((d) => /\$Damage Type:.*"Laser"/i.test(d.message)),
      `did not expect a diagnostic for the valid "Laser" damage type, got: ${JSON.stringify(messages)}`,
    );

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const laserLine = lines.findIndex((l) => l.includes("$Damage Type: Laser"));
    const plasmaLine = lines.findIndex((l) => l.includes("$Damage Type: Plasma"));
    assert.ok(laserLine >= 0 && plasmaLine >= 0, "fixture must contain both damage-type lines");

    const laserHover = await getHoverText(uri, laserLine);
    assert.ok(laserHover.includes("✓"), `expected a found checkmark for Laser, got: ${laserHover}`);

    const plasmaHover = await getHoverText(uri, plasmaLine);
    assert.ok(plasmaHover.includes("⚠"), `expected a warning for Plasma, got: ${plasmaHover}`);
  });

  test("does not false-positive on a real-shaped species_defs.tbm ($Species_Name: entry-key field)", async () => {
    // Regression test: an earlier version of this schema used "$Species Name:" (space)
    // as the entry-key field, but the real field is "$Species_Name:" (underscore). That
    // mismatch meant per-entry order tracking never reset between species, which could
    // misattribute a field from one entry as "out of order" relative to a previous
    // entry's state. This fixture mirrors a real bp-sdf.tbm-style file closely enough
    // to catch that regression if it comes back.
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/mymod-sdf.tbm"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    const diagnostics = await waitForDiagnostics(uri, 3000);
    const orderDiagnostics = diagnostics.filter((d) => /out of the expected field order/i.test(d.message));
    assert.strictEqual(
      orderDiagnostics.length,
      0,
      `expected no field-order diagnostics on a real-shaped species_defs.tbm, got: ${JSON.stringify(orderDiagnostics.map((d) => d.message))}`,
    );
  });

  test("completes field names from the ships.tbl schema when typing $", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    // Insert a fresh "$" on its own line inside the Ship Classes section and ask for completions there.
    const insertLine = 2; // right after "$Name: GTF Ulysses"
    await editor.edit((builder) => builder.insert(new vscode.Position(insertLine, 0), "$\n"));
    try {
      const list = (await vscode.commands.executeCommand(
        "vscode.executeCompletionItemProvider",
        uri,
        new vscode.Position(insertLine, 1),
      )) as vscode.CompletionList;
      const labels = list.items.map((i) => (typeof i.label === "string" ? i.label : i.label.label));
      assert.ok(
        labels.some((l) => l.startsWith("Short name")),
        `expected "Short name:" among field completions, got: ${JSON.stringify(labels)}`,
      );
      assert.ok(
        labels.some((l) => l.startsWith("POF file")),
        `expected "POF file:" among field completions, got: ${JSON.stringify(labels)}`,
      );
    } finally {
      await editor.edit((builder) =>
        builder.delete(new vscode.Range(new vscode.Position(insertLine, 0), new vscode.Position(insertLine + 1, 0))),
      );
    }
  });

  test("completes texture names from the mod's search path for $Ship_icon:", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const iconLine = lines.findIndex((l) => l.includes("$Ship_icon:"));
    assert.ok(iconLine >= 0, "fixture must contain a $Ship_icon: line");
    const lineLength = lines[iconLine].length;

    const list = (await vscode.commands.executeCommand(
      "vscode.executeCompletionItemProvider",
      uri,
      new vscode.Position(iconLine, lineLength),
    )) as vscode.CompletionList;
    const labels = list.items.map((i) => (typeof i.label === "string" ? i.label : i.label.label));
    assert.ok(
      labels.includes("iconfighter04"),
      `expected the fixture texture in completions, got: ${JSON.stringify(labels)}`,
    );
  });

  test("texture completions carry an explicit replacement range (so hyphenated names filter/delete correctly)", async () => {
    // Regression test: completion items for texture fields had no explicit textEdit
    // range, so the client fell back to its own default word-boundary detection - which
    // doesn't treat '-' as part of a word. Real texture names are commonly hyphenated
    // (e.g. "0-anti2-normal" in a real Blue Planet install), so deleting/retyping past a
    // hyphen made the client re-derive a shorter "current word" and re-query the server
    // instead of filtering the existing list locally - both the "deleting letters
    // doesn't give a nice tab complete" and "slow to update" symptoms reported traced
    // back to this. Every item must now carry a textEdit spanning the whole value token.
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/weapons.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const laserBitmapLine = lines.findIndex((l) => l.includes("@Laser Bitmap:"));
    assert.ok(laserBitmapLine >= 0, "fixture must contain an @Laser Bitmap: line");
    const lineLength = lines[laserBitmapLine].length;

    const list = (await vscode.commands.executeCommand(
      "vscode.executeCompletionItemProvider",
      uri,
      new vscode.Position(laserBitmapLine, lineLength),
    )) as vscode.CompletionList;
    const labels = list.items.map((i) => (typeof i.label === "string" ? i.label : i.label.label));
    assert.ok(
      labels.includes("railgun-bitmap"),
      `expected the hyphenated fixture texture in completions, got: ${JSON.stringify(labels)}`,
    );

    const item = list.items.find((i) => (typeof i.label === "string" ? i.label : i.label.label) === "railgun-bitmap");
    assert.ok(item, "expected to find the railgun-bitmap completion item");
    assert.ok(item!.textEdit, `expected an explicit textEdit on the completion item, got: ${JSON.stringify(item)}`);
    const edit = item!.textEdit as vscode.TextEdit;
    assert.strictEqual(edit.newText, "railgun-bitmap");
    // The replacement range should span the whole existing value ("railgun-bitmap"),
    // starting right after the colon+whitespace, not just a shorter hyphen-delimited word.
    const rangeText = doc.getText(edit.range);
    assert.strictEqual(rangeText, "railgun-bitmap");
  });

  test("provides an outline for ships.tbl with a section and per-ship symbols", async () => {
    const shipsTblPath = path.join(fixturesRoot, "data/tables/ships.tbl");
    const uri = vscode.Uri.file(shipsTblPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri); // ensure the server has processed this document at least once

    const fileText = fs.readFileSync(shipsTblPath, "utf8");
    const shipNames = [...fileText.matchAll(/^\$Name:\s*(.+?)\s*$/gm)].map((m) => m[1]);
    assert.ok(shipNames.length > 0, "fixture must contain at least one $Name: entry");

    const symbols = (await vscode.commands.executeCommand(
      "vscode.executeDocumentSymbolProvider",
      uri,
    )) as vscode.DocumentSymbol[];
    assert.ok(symbols && symbols.length > 0, "expected at least one top-level outline symbol");

    const shipClasses = symbols.find((s) => s.name === "Ship Classes");
    assert.ok(shipClasses, `expected a "Ship Classes" top-level symbol, got: ${JSON.stringify(symbols.map((s) => s.name))}`);

    for (const shipName of shipNames) {
      assert.ok(
        shipClasses!.children.some((c) => c.name === shipName),
        `expected a child symbol named "${shipName}", got: ${JSON.stringify(shipClasses!.children.map((c) => c.name))}`,
      );
    }
  });

  test("does not lose entries after a bare +nocreate with no following multi-line block", async () => {
    // Regression test: a bare `+nocreate` (no colon, no value) was incorrectly treated
    // as the start of a free-text block awaiting a literal "$end_multi_text" terminator
    // - the same heuristic meant for fields like `+Description: XSTR("` that leave a
    // multi-line quoted block open. When a weapon's own +nocreate had no such block
    // following it, the parser scanned forward for the *next* $end_multi_text anywhere
    // in the file and silently swallowed every entry in between as garbage field value.
    // This fixture reproduces that exact shape: a weapon with a real multi-line
    // +Description:, then one with a bare +nocreate and nothing else, then a plain
    // weapon, then another with a multi-line +Description: far later.
    const weaponsTblPath = path.join(fixturesRoot, "data/tables/weapons.tbl");
    const uri = vscode.Uri.file(weaponsTblPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const symbols = (await vscode.commands.executeCommand(
      "vscode.executeDocumentSymbolProvider",
      uri,
    )) as vscode.DocumentSymbol[];
    const primaryWeapons = symbols.find((s) => s.name === "Primary Weapons");
    assert.ok(primaryWeapons, `expected a "Primary Weapons" top-level symbol, got: ${JSON.stringify(symbols.map((s) => s.name))}`);

    const childNames = primaryWeapons!.children.map((c) => c.name);
    for (const expected of ["Subach HL-7", "@Subach HL-D", "In Between Weapon", "Shivan Heavy Laser"]) {
      assert.ok(childNames.includes(expected), `expected "${expected}" in the outline, got: ${JSON.stringify(childNames)}`);
    }
  });

  test("does not lose entries after a $Pspew:-style empty-value field with ordinary +Subfield children", async () => {
    // Regression test: a colon-having field left with an empty value on its own line
    // (e.g. `$Pspew:`, followed by ordinary `+Count:`/`+Time:`/etc. sub-fields, NOT
    // free text) was, like the bare +nocreate case above, incorrectly treated as the
    // start of a free-text block awaiting a literal "$end_multi_text"/"$end_custom_data"
    // terminator. That heuristic scanned forward for the next such marker anywhere in
    // the file and swallowed everything in between - confirmed against a real
    // weapons.tbl where a weapon's own $Pspew: block ate through "Maul", "Maul#swap",
    // and "Maul#child" up to a much later, unrelated entry's description terminator.
    const weaponsTblPath = path.join(fixturesRoot, "data/tables/weapons.tbl");
    const uri = vscode.Uri.file(weaponsTblPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const symbols = (await vscode.commands.executeCommand(
      "vscode.executeDocumentSymbolProvider",
      uri,
    )) as vscode.DocumentSymbol[];
    const primaryWeapons = symbols.find((s) => s.name === "Primary Weapons");
    assert.ok(primaryWeapons, `expected a "Primary Weapons" top-level symbol, got: ${JSON.stringify(symbols.map((s) => s.name))}`);

    const childNames = primaryWeapons!.children.map((c) => c.name);
    for (const expected of ["Maul", "Maul#swap", "Maul#child", "Shivan Heavy Laser"]) {
      assert.ok(childNames.includes(expected), `expected "${expected}" in the outline, got: ${JSON.stringify(childNames)}`);
    }
  });
});

async function getHoverText(uri: vscode.Uri, line: number): Promise<string> {
  const hovers = (await vscode.commands.executeCommand(
    "vscode.executeHoverProvider",
    uri,
    new vscode.Position(line, 5),
  )) as vscode.Hover[];
  assert.ok(hovers && hovers.length > 0, `expected at least one hover result at line ${line}`);
  return hovers[0].contents
    .map((c) => (typeof c === "string" ? c : (c as vscode.MarkdownString).value))
    .join("\n");
}

async function waitForDiagnostics(uri: vscode.Uri, timeoutMs = 10000): Promise<vscode.Diagnostic[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    if (diagnostics.length > 0) {
      return diagnostics;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return vscode.languages.getDiagnostics(uri);
}
