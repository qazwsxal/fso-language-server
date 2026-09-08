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

  test("flags a ship $Species: that doesn't exist in species_defs.tbl, but not a real one", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    const diagnostics = await waitForDiagnostics(uri);
    const messages = diagnostics.map((d) => d.message);
    assert.ok(
      diagnostics.some((d) => /\$Species:.*"Nonexistent Species".*was not found in species_defs\.tbl/i.test(d.message)),
      `expected an unresolved species diagnostic, got: ${JSON.stringify(messages)}`,
    );
    assert.ok(
      messages.some((m) => /\$Species:.*"Vasudan"/i.test(m)) === false,
      `did not expect a missing-species warning for the real "Vasudan" entry, got: ${JSON.stringify(messages)}`,
    );

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const goodSpeciesLine = lines.findIndex((l) => l.includes("$Species: Vasudan"));
    const badSpeciesLine = lines.findIndex((l) => l.includes("$Species: Nonexistent Species"));
    assert.ok(goodSpeciesLine >= 0 && badSpeciesLine >= 0, "fixture must contain both a matching and mismatching $Species: line");

    const goodHover = await getHoverText(uri, goodSpeciesLine);
    assert.ok(goodHover.includes("✓"), `expected a found checkmark, got: ${goodHover}`);
    assert.ok(goodHover.includes("species_defs.tbl"), `expected the resolved species_defs.tbl location in hover, got: ${goodHover}`);

    const badHover = await getHoverText(uri, badSpeciesLine);
    assert.ok(badHover.includes("⚠"), `expected a species warning in hover, got: ${badHover}`);
  });

  test("go-to-definition on a ship's $Species: jumps to species_defs.tbl's matching $Species_Name:", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const speciesLine = lines.findIndex((l) => l.includes("$Species: Vasudan"));
    assert.ok(speciesLine >= 0, "fixture must contain a $Species: Vasudan line");

    const locations = (await vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider",
      uri,
      new vscode.Position(speciesLine, lines[speciesLine].length - 2),
    )) as vscode.Location[];
    assert.ok(locations && locations.length > 0, "expected at least one definition location");
    assert.ok(
      locations[0].uri.fsPath.endsWith(path.join("data", "tables", "species_defs.tbl")),
      `expected the definition to point at species_defs.tbl, got: ${locations[0].uri.toString()}`,
    );
    const speciesTblText = fs.readFileSync(path.join(fixturesRoot, "data/tables/species_defs.tbl"), "utf8");
    const expectedLine = speciesTblText.split(/\r\n|\r|\n/).findIndex((l) => l.includes("$Species_Name:\t\tVasudan"));
    assert.strictEqual(locations[0].range.start.line, expectedLine);
  });

  test("completes a ship's $Species: value from species_defs.tbl's entry names", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const speciesLine = lines.findIndex((l) => l.includes("$Species: Vasudan"));

    const list = (await vscode.commands.executeCommand(
      "vscode.executeCompletionItemProvider",
      uri,
      new vscode.Position(speciesLine, lines[speciesLine].length),
    )) as vscode.CompletionList;
    const labels = list.items.map((i) => (typeof i.label === "string" ? i.label : i.label.label));
    assert.ok(labels.includes("Vasudan"), `expected "Vasudan" in species completions, got: ${JSON.stringify(labels)}`);
    assert.ok(labels.includes("Terran"), `expected "Terran" in species completions too, got: ${JSON.stringify(labels)}`);
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

  test("completes a ship's $Armor Type: value from armor.tbl's entry names", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const armorLine = lines.findIndex((l) => l.includes("$Armor Type: Standard"));
    assert.ok(armorLine >= 0, "fixture must contain a $Armor Type: Standard line (GTF Apollo)");

    const list = (await vscode.commands.executeCommand(
      "vscode.executeCompletionItemProvider",
      uri,
      new vscode.Position(armorLine, lines[armorLine].length),
    )) as vscode.CompletionList;
    const labels = list.items.map((i) => (typeof i.label === "string" ? i.label : i.label.label));
    assert.ok(labels.includes("Standard"), `expected "Standard" among armor-type completions, got: ${JSON.stringify(labels)}`);
  });

  test("completes a weapon's $Damage Type: value from armor.tbl's referenced damage types", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/weapons.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const damageLine = lines.findIndex((l) => l.includes("$Damage Type: Laser"));
    assert.ok(damageLine >= 0, "fixture must contain a $Damage Type: Laser line");

    const list = (await vscode.commands.executeCommand(
      "vscode.executeCompletionItemProvider",
      uri,
      new vscode.Position(damageLine, lines[damageLine].length),
    )) as vscode.CompletionList;
    const labels = list.items.map((i) => (typeof i.label === "string" ? i.label : i.label.label));
    assert.ok(labels.includes("Laser"), `expected "Laser" among damage-type completions, got: ${JSON.stringify(labels)}`);
    assert.ok(labels.includes("Flak"), `expected "Flak" among damage-type completions, got: ${JSON.stringify(labels)}`);
  });

  test("go-to-definition on a ship's $Armor Type: jumps to armor.tbl's matching $Name:", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const armorLine = lines.findIndex((l) => l.includes("$Armor Type: Standard"));
    assert.ok(armorLine >= 0, "fixture must contain a $Armor Type: Standard line (GTF Apollo)");

    const locations = (await vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider",
      uri,
      new vscode.Position(armorLine, lines[armorLine].length - 2),
    )) as vscode.Location[];
    assert.ok(locations && locations.length > 0, "expected at least one definition location");
    assert.ok(
      locations[0].uri.fsPath.endsWith(path.join("data", "tables", "armor.tbl")),
      `expected the definition to point at armor.tbl, got: ${locations[0].uri.toString()}`,
    );
    const armorTblText = fs.readFileSync(path.join(fixturesRoot, "data/tables/armor.tbl"), "utf8");
    const expectedLine = armorTblText.split(/\r\n|\r|\n/).findIndex((l) => l.includes("$Name: Standard"));
    assert.strictEqual(locations[0].range.start.line, expectedLine);
  });

  test("go-to-declaration on a weapon's $Damage Type: jumps to armor.tbl's matching $Damage Type: entries", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/weapons.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const damageLine = lines.findIndex((l) => l.includes("$Damage Type: Laser"));
    assert.ok(damageLine >= 0, "fixture must contain a $Damage Type: Laser line");

    const locations = (await vscode.commands.executeCommand(
      "vscode.executeDeclarationProvider",
      uri,
      new vscode.Position(damageLine, lines[damageLine].length - 1),
    )) as vscode.Location[];
    assert.ok(locations && locations.length > 0, "expected at least one declaration location");
    assert.ok(
      locations.every((loc) => loc.uri.fsPath.endsWith(path.join("data", "tables", "armor.tbl"))),
      `expected every declaration location to point at armor.tbl, got: ${JSON.stringify(locations.map((l) => l.uri.toString()))}`,
    );
  });

  test("tab-completion on a $Default PBanks: weapon name completes from weapons.tbl", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const bankLine = lines.findIndex((l) => l.includes("$Default PBanks:"));
    assert.ok(bankLine >= 0, "fixture must contain a $Default PBanks: line");
    const quoteStart = lines[bankLine].indexOf('"Subach HL-7"') + 1;

    const list = (await vscode.commands.executeCommand(
      "vscode.executeCompletionItemProvider",
      uri,
      new vscode.Position(bankLine, quoteStart + "Suba".length),
    )) as vscode.CompletionList;
    const labels = list.items.map((i) => (typeof i.label === "string" ? i.label : i.label.label));
    assert.ok(labels.includes("Subach HL-7"), `expected "Subach HL-7" in completions, got: ${JSON.stringify(labels)}`);
  });

  test("flags a $Default SBanks: weapon name that doesn't exist in weapons.tbl, but not a real one", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    const diagnostics = await waitForDiagnostics(uri);

    const messages = diagnostics.map((d) => d.message);
    assert.ok(
      messages.some((m) => /\$Default SBanks:.*"Nonexistent Weapon"/i.test(m)),
      `expected a missing-weapon warning for "Nonexistent Weapon", got: ${JSON.stringify(messages)}`,
    );
    assert.ok(
      messages.some((m) => /\$Default PBanks:.*"Subach HL-7"/i.test(m)) === false,
      `did not expect a missing-weapon warning for the real "Subach HL-7" entry, got: ${JSON.stringify(messages)}`,
    );
  });

  test("go-to-definition on a $Default PBanks: weapon name jumps to weapons.tbl's matching $Name:", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const bankLine = lines.findIndex((l) => l.includes("$Default PBanks:"));
    assert.ok(bankLine >= 0, "fixture must contain a $Default PBanks: line");
    const nameCol = lines[bankLine].indexOf("Subach HL-7") + 3;

    const locations = (await vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider",
      uri,
      new vscode.Position(bankLine, nameCol),
    )) as vscode.Location[];
    assert.ok(locations && locations.length > 0, "expected at least one definition location");
    assert.ok(
      locations[0].uri.fsPath.endsWith(path.join("data", "tables", "weapons.tbl")),
      `expected the definition to point at weapons.tbl, got: ${locations[0].uri.toString()}`,
    );
    const weaponsTblText = fs.readFileSync(path.join(fixturesRoot, "data/tables/weapons.tbl"), "utf8");
    const expectedLine = weaponsTblText.split(/\r\n|\r|\n/).findIndex((l) => l.includes("$Name: Subach HL-7"));
    assert.strictEqual(locations[0].range.start.line, expectedLine);
  });

  test("resolves a turret's own $Default PBanks: (inside $Subsystem:), not just the ship-level one", async () => {
    // Regression test: a real Blue Planet bp-shp.tbm shows turret-level $Default
    // PBanks:/$Default SBanks: (nested inside a $Subsystem: block) as the *majority*
    // real-world occurrence (~81% of all bank-list lines) - the ship-level-only
    // extraction this feature started with would silently miss almost every real
    // weapon-bank reference.
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    const diagnostics = await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const turretBankLine = lines.findIndex((l) => l.includes('"Interceptor Cannon"'));
    assert.ok(turretBankLine >= 0, "fixture must contain a turret-level $Default PBanks: line");

    // The empty "" slot (a real, common "no weapon assigned" shape) must not be flagged.
    const messages = diagnostics.map((d) => d.message);
    assert.ok(
      messages.filter((m) => m.includes("turret01")).every((m) => !/references weapon ""/i.test(m)),
      `did not expect a missing-weapon warning for an empty bank slot, got: ${JSON.stringify(messages)}`,
    );

    const nameCol = lines[turretBankLine].indexOf("Interceptor Cannon");
    const hovers = (await vscode.commands.executeCommand(
      "vscode.executeHoverProvider",
      uri,
      new vscode.Position(turretBankLine, nameCol),
    )) as vscode.Hover[];
    assert.ok(hovers && hovers.length > 0, "expected a hover result on the turret's weapon name token");
    const hoverText = hovers[0].contents
      .map((c) => (typeof c === "string" ? c : (c as vscode.MarkdownString).value))
      .join("\n");
    assert.ok(hoverText.includes("✓"), `expected a found checkmark, got: ${hoverText}`);
  });

  test("matches a bank-list weapon name against a weapons.tbl entry whose $Name: has a leading @ (tech-room-hidden)", async () => {
    // Regression test: FSO's `@` prefix on `$Name:` hides an entry from tech-room
    // listings but is NOT part of the name used for matching elsewhere - a real
    // Blue Planet bp-wep.tbm names ~24 weapons this way (e.g. "@Subach HL-7"), and
    // ships' bank lists reference them WITHOUT the @ ("Subach HL-7"). Matching on the
    // raw, unstripped $Name: value produced false "not found" warnings on some of the
    // most common weapons in that mod.
    const shipsUri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const shipsDoc = await vscode.workspace.openTextDocument(shipsUri);
    await vscode.window.showTextDocument(shipsDoc);
    const diagnostics = await waitForDiagnostics(shipsUri);

    const messages = diagnostics.map((d) => d.message);
    assert.ok(
      messages.some((m) => /"Interceptor Cannon"/i.test(m) && /not found/i.test(m)) === false,
      `did not expect a missing-weapon warning for "Interceptor Cannon" (defined as "@Interceptor Cannon"), got: ${JSON.stringify(messages)}`,
    );

    const lines = shipsDoc.getText().split(/\r\n|\r|\n/);
    const turretBankLine = lines.findIndex((l) => l.includes('"Interceptor Cannon"'));
    const nameCol = lines[turretBankLine].indexOf("Interceptor Cannon");

    const locations = (await vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider",
      shipsUri,
      new vscode.Position(turretBankLine, nameCol),
    )) as vscode.Location[];
    assert.ok(locations && locations.length > 0, "expected at least one definition location");
    assert.ok(
      locations[0].uri.fsPath.endsWith(path.join("data", "tables", "weapons.tbl")),
      `expected the definition to point at weapons.tbl, got: ${locations[0].uri.toString()}`,
    );
    const weaponsTblText = fs.readFileSync(path.join(fixturesRoot, "data/tables/weapons.tbl"), "utf8");
    const expectedLine = weaponsTblText.split(/\r\n|\r|\n/).findIndex((l) => l.includes("$Name: @Interceptor Cannon"));
    assert.strictEqual(locations[0].range.start.line, expectedLine);
  });

  test("hover on a $Default PBanks: weapon name shows its found/defined status", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const bankLine = lines.findIndex((l) => l.includes("$Default PBanks:"));
    const nameCol = lines[bankLine].indexOf("Subach HL-7") + 3;

    const hovers = (await vscode.commands.executeCommand(
      "vscode.executeHoverProvider",
      uri,
      new vscode.Position(bankLine, nameCol),
    )) as vscode.Hover[];
    assert.ok(hovers && hovers.length > 0, "expected a hover result on the weapon name token");
    const hoverText = hovers[0].contents
      .map((c) => (typeof c === "string" ? c : (c as vscode.MarkdownString).value))
      .join("\n");
    assert.ok(hoverText.includes("✓"), `expected a found checkmark, got: ${hoverText}`);
    assert.ok(hoverText.includes("weapons.tbl"), `expected the resolved weapons.tbl location in hover, got: ${hoverText}`);
  });

  test("hover on a resolved texture shows its location, not just found/not-found", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const iconLine = lines.findIndex((l) => l.includes("$Ship_icon:"));
    const hoverText = await getHoverText(uri, iconLine);
    assert.ok(hoverText.includes("✓"), `expected a found checkmark, got: ${hoverText}`);
    assert.ok(hoverText.includes("iconfighter04.dds"), `expected the resolved file path in hover, got: ${hoverText}`);
  });

  test("F12 on a $Subsystem: line opens the 3D POF viewer instead of returning a text location", async () => {
    // The 3D viewer is a side effect (opening a webview), not a navigable text
    // Location, so `vscode.executeDefinitionProvider` is expected to come back empty
    // for this line - the real assertion is that invoking it doesn't throw, and that a
    // new "POF: fighter01.pof" webview tab appears as a result of the client-side
    // definition provider's side effect (see client/src/extension.ts /
    // client/src/pofViewer.ts).
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const turretLine = lines.findIndex((l) => l.includes("$Subsystem: turret01"));
    assert.ok(turretLine >= 0, "fixture must contain a $Subsystem: turret01 line");

    const tabsBefore = countPofViewerTabs();

    await vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider",
      uri,
      new vscode.Position(turretLine, 5),
    );

    // Poll briefly: the provider's server round trip + webview creation happen asynchronously.
    const opened = await waitFor(() => countPofViewerTabs() > tabsBefore, 5000);
    assert.ok(opened, "expected a new 'POF: fighter01.pof' webview tab to open after F12 on $Subsystem: turret01");
  });

  test("F12 elsewhere in ships.tbl does not open the 3D viewer", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const nameLine = lines.findIndex((l) => l.includes("$Name: GTF Ulysses"));
    assert.ok(nameLine >= 0);

    const tabsBefore = countPofViewerTabs();
    const result = await vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider",
      uri,
      new vscode.Position(nameLine, 2),
    );
    assert.ok(!result || (Array.isArray(result) && result.length === 0), "expected no definition result on a non-subsystem line");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(countPofViewerTabs(), tabsBefore, "did not expect a new POF viewer tab from a non-subsystem line");
  });
});

/** Counts open editor tabs whose label matches the 3D POF viewer webview panel's title ("POF: <filename>"). */
function countPofViewerTabs(): number {
  let count = 0;
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.label.startsWith("POF: ")) {
        count++;
      }
    }
  }
  return count;
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return predicate();
}

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
