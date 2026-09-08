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

  test("does not flag a turret's own $Flags: as out of order relative to the ship-level $Flags:", async () => {
    // Regression test: a real Blue Planet ships.tbm showed every single turret's
    // $Flags: line flagged "out of the expected field order" - the schema validator has
    // no concept of $Subsystem: opening a nested, block-local scope, so it was comparing
    // a turret's own $Flags: (which legitimately repeats the field name) against the
    // ship-level $Flags:'s position, and since $Subsystem: itself sits later in the
    // field-order list than $Flags:, every subsequent per-turret $Flags: read as "out of
    // order" no matter how the file was actually written.
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    const diagnostics = await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const turretFlagsLine = lines.findIndex((l) => l.includes('"turret-lock"'));
    assert.ok(turretFlagsLine >= 0, "fixture must contain a turret-level $Flags: line");

    assert.ok(
      diagnostics.every((d) => d.range.start.line !== turretFlagsLine),
      `did not expect any diagnostic on the turret's own $Flags: line, got: ${JSON.stringify(diagnostics.filter((d) => d.range.start.line === turretFlagsLine).map((d) => d.message))}`,
    );
  });

  test("flags a ship $AI Class: that doesn't exist in ai.tbl, but not a real one", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    const diagnostics = await waitForDiagnostics(uri);

    const messages = diagnostics.map((d) => d.message);
    assert.ok(
      messages.some((m) => /\$AI Class:.*"Nonexistent AI Class".*was not found in ai\.tbl/i.test(m)),
      `expected an unresolved AI-class diagnostic, got: ${JSON.stringify(messages)}`,
    );
    assert.ok(
      messages.some((m) => /\$AI Class:.*"Rookie"/i.test(m)) === false,
      `did not expect a missing-AI-class warning for the real "Rookie" entry, got: ${JSON.stringify(messages)}`,
    );

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const goodLine = lines.findIndex((l) => l.includes("$AI Class: Rookie"));
    const badLine = lines.findIndex((l) => l.includes("$AI Class: Nonexistent AI Class"));
    assert.ok(goodLine >= 0 && badLine >= 0, "fixture must contain both a matching and mismatching $AI Class: line");

    const goodHover = await getHoverText(uri, goodLine);
    assert.ok(goodHover.includes("✓"), `expected a found checkmark, got: ${goodHover}`);
    assert.ok(goodHover.includes("ai.tbl"), `expected the resolved ai.tbl location in hover, got: ${goodHover}`);
  });

  test("go-to-definition on a ship's $AI Class: jumps to ai.tbl's matching $Name:", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const aiClassLine = lines.findIndex((l) => l.includes("$AI Class: Rookie"));
    assert.ok(aiClassLine >= 0, "fixture must contain a $AI Class: Rookie line");

    const locations = (await vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider",
      uri,
      new vscode.Position(aiClassLine, lines[aiClassLine].length - 1),
    )) as vscode.Location[];
    assert.ok(locations && locations.length > 0, "expected at least one definition location");
    assert.ok(
      locations[0].uri.fsPath.endsWith(path.join("data", "tables", "ai.tbl")),
      `expected the definition to point at ai.tbl, got: ${locations[0].uri.toString()}`,
    );
  });

  test("flags a species' $Default IFF: that doesn't exist in iff_defs.tbl, but not a real one", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/mymod-sdf.tbm"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    const diagnostics = await waitForDiagnostics(uri);

    const messages = diagnostics.map((d) => d.message);
    assert.ok(
      messages.some((m) => /\$Default IFF:.*"Nonexistent IFF".*was not found in iff_defs\.tbl/i.test(m)),
      `expected an unresolved IFF diagnostic, got: ${JSON.stringify(messages)}`,
    );
    assert.ok(
      messages.some((m) => /\$Default IFF:.*"Friendly"/i.test(m)) === false,
      `did not expect a missing-IFF warning for the real "Friendly" entry, got: ${JSON.stringify(messages)}`,
    );

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const goodLine = lines.findIndex((l) => l.includes("$Default IFF:\t\tFriendly"));
    assert.ok(goodLine >= 0, "fixture must contain a $Default IFF: Friendly line");

    const goodHover = await getHoverText(uri, goodLine);
    assert.ok(goodHover.includes("✓"), `expected a found checkmark, got: ${goodHover}`);
    assert.ok(goodHover.includes("iff_defs.tbl"), `expected the resolved iff_defs.tbl location in hover, got: ${goodHover}`);
  });

  test("go-to-definition on a species' $Default IFF: jumps to iff_defs.tbl's matching $IFF Name:", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/mymod-sdf.tbm"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const iffLine = lines.findIndex((l) => l.includes("$Default IFF:\t\tFriendly"));
    assert.ok(iffLine >= 0, "fixture must contain a $Default IFF: Friendly line");

    const locations = (await vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider",
      uri,
      new vscode.Position(iffLine, lines[iffLine].length - 1),
    )) as vscode.Location[];
    assert.ok(locations && locations.length > 0, "expected at least one definition location");
    assert.ok(
      locations[0].uri.fsPath.endsWith(path.join("data", "tables", "iff_defs.tbl")),
      `expected the definition to point at iff_defs.tbl, got: ${locations[0].uri.toString()}`,
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

  test("go-to-definition on a ship's $Armor Type: returns one location per layer that touched the entry, for cycling", async () => {
    // mymod-amr.tbm re-touches armor.tbl's "Standard" entry (with +nocreate) - so the
    // merged armor table now has two layers' worth of history for "Standard": the base
    // armor.tbl $Name: line, and the .tbm's $Name: line. Go-to-definition should surface
    // both as separate Locations so VS Code's built-in peek/cycle UI can step through
    // them, instead of only ever returning the last layer that happened to touch it.
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

    assert.strictEqual(
      locations.length,
      2,
      `expected 2 definition locations (armor.tbl base + mymod-amr.tbm layer), got: ${JSON.stringify(locations.map((l) => l.uri.toString()))}`,
    );

    const armorTblText = fs.readFileSync(path.join(fixturesRoot, "data/tables/armor.tbl"), "utf8");
    const expectedBaseLine = armorTblText.split(/\r\n|\r|\n/).findIndex((l) => l.includes("$Name: Standard"));
    const tbmText = fs.readFileSync(path.join(fixturesRoot, "data/tables/mymod-amr.tbm"), "utf8");
    const expectedTbmLine = tbmText.split(/\r\n|\r|\n/).findIndex((l) => l.includes("$Name: Standard"));

    assert.ok(
      locations[0].uri.fsPath.endsWith(path.join("data", "tables", "armor.tbl")),
      `expected the first location to point at armor.tbl (base layer applied first), got: ${locations[0].uri.toString()}`,
    );
    assert.strictEqual(locations[0].range.start.line, expectedBaseLine);

    assert.ok(
      locations[1].uri.fsPath.endsWith(path.join("data", "tables", "mymod-amr.tbm")),
      `expected the second location to point at mymod-amr.tbm, got: ${locations[1].uri.toString()}`,
    );
    assert.strictEqual(locations[1].range.start.line, expectedTbmLine);
  });

  test("go-to-definition works when clicking the second word of a multi-word cross-reference value", async () => {
    // Regression test: reported as "go to definition/declaration don't seem to work on
    // multi-word names". Every prior go-to-definition test happened to click a
    // single-word value, or the first word/character of a multi-word one - clicking
    // squarely on the SECOND word of a multi-word value was never actually exercised.
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);

    // Line-based cross-reference (no column restriction at all): $Shield Armor Type: Heavy Armor
    const shieldArmorLine = lines.findIndex((l) => l.includes("$Shield Armor Type: Heavy Armor"));
    assert.ok(shieldArmorLine >= 0, "fixture must contain a $Shield Armor Type: Heavy Armor line");
    const secondWordCol = lines[shieldArmorLine].indexOf("Armor", lines[shieldArmorLine].indexOf("Heavy Armor")) + 2;

    const shieldLocations = (await vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider",
      uri,
      new vscode.Position(shieldArmorLine, secondWordCol),
    )) as vscode.Location[];
    assert.ok(
      shieldLocations && shieldLocations.length > 0,
      `expected a definition location when clicking the second word of "Heavy Armor", got none`,
    );
    assert.ok(
      shieldLocations[0].uri.fsPath.endsWith(path.join("data", "tables", "armor.tbl")),
      `expected the definition to point at armor.tbl, got: ${shieldLocations[0].uri.toString()}`,
    );

    // Token-based cross-reference (quoted-range restricted): $Default PBanks: ( "Interceptor Cannon" "" )
    const bankLine = lines.findIndex((l) => l.includes('"Interceptor Cannon"'));
    assert.ok(bankLine >= 0, "fixture must contain the turret's $Default PBanks: line");
    const cannonCol = lines[bankLine].indexOf("Cannon") + 2;

    const bankLocations = (await vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider",
      uri,
      new vscode.Position(bankLine, cannonCol),
    )) as vscode.Location[];
    assert.ok(
      bankLocations && bankLocations.length > 0,
      `expected a definition location when clicking the second word of "Interceptor Cannon", got none`,
    );
    assert.ok(
      bankLocations[0].uri.fsPath.endsWith(path.join("data", "tables", "weapons.tbl")),
      `expected the definition to point at weapons.tbl, got: ${bankLocations[0].uri.toString()}`,
    );
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
    // F12 is bound (see package.json's "keybindings", scoped to editorLangId ==
    // fso-table) to a dedicated command rather than a languages.registerDefinitionProvider
    // - see the doc comment on that command in client/src/extension.ts for why: a
    // registered DefinitionProvider fires on every ctrl+hover mouse move (VSCode calls it
    // to decide whether to show the "click here" underline, not just on an actual
    // click/F12 - a documented, currently-unchangeable VSCode behavior), so a provider
    // that performs a real side effect popped the viewer open just from resting the
    // mouse over a subsystem line with Ctrl held. The command, bound only to the actual
    // F12 keypress, doesn't have that problem.
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const turretLine = lines.findIndex((l) => l.includes("$Subsystem: turret01"));
    assert.ok(turretLine >= 0, "fixture must contain a $Subsystem: turret01 line");

    const tabsBefore = countPofViewerTabs();
    editor.selection = new vscode.Selection(turretLine, 5, turretLine, 5);
    await vscode.commands.executeCommand("fsoLsp.revealDefinitionOrPofViewer");

    // Poll briefly: the command's server round trip + webview creation happen asynchronously.
    const opened = await waitFor(() => countPofViewerTabs() > tabsBefore, 5000);
    assert.ok(opened, "expected a new 'POF: fighter01.pof' webview tab to open after F12 on $Subsystem: turret01");
  });

  test("merely computing go-to-definition (as VSCode does on every ctrl+hover) does NOT open the 3D viewer", async () => {
    // Regression test: reported as "just tapping control seems to open the pof". Before
    // the F12-command fix above, the viewer was opened directly from inside a
    // languages.registerDefinitionProvider, which VSCode invokes on ctrl+hover alone
    // (see the doc comment in extension.ts) - simulating that exact call here
    // (vscode.executeDefinitionProvider, with no F12/click involved) must NOT open a
    // viewer tab, proving the side effect no longer lives on that code path.
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const turretLine = lines.findIndex((l) => l.includes("$Subsystem: turret01"));
    assert.ok(turretLine >= 0, "fixture must contain a $Subsystem: turret01 line");

    const tabsBefore = countPofViewerTabs();
    await vscode.commands.executeCommand("vscode.executeDefinitionProvider", uri, new vscode.Position(turretLine, 5));
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(
      countPofViewerTabs(),
      tabsBefore,
      "did not expect a POF viewer tab from a hover-style go-to-definition computation alone",
    );
  });

  test("F12 on a different $Subsystem: of the same, already-open model reuses the panel instead of opening a second one", async () => {
    // Regression coverage for the highlight-only update path (see pofViewer.ts's
    // fingerprint()-based dispatch, added so re-triggering F12 on a different
    // subsystem of the same model doesn't visibly "reload" the viewer - previously
    // this reset the user's camera angle/zoom every time, even though the panel was
    // already being reused). This test can't inspect the webview's internal three.js
    // state (no such API), but it does confirm the client-side flow that decides
    // between a highlight-only message and a full reload doesn't regress the existing
    // "only one panel, ever" behavior or throw.
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const turretLine = lines.findIndex((l) => l.includes("$Subsystem: turret01"));
    const engineLine = lines.findIndex((l) => l.includes("$Subsystem: engine01,"));
    assert.ok(turretLine >= 0 && engineLine >= 0, "fixture must contain both a turret01 and engine01 $Subsystem: line");

    const tabsBefore = countPofViewerTabs();
    editor.selection = new vscode.Selection(turretLine, 5, turretLine, 5);
    await vscode.commands.executeCommand("fsoLsp.revealDefinitionOrPofViewer");
    await waitFor(() => countPofViewerTabs() > tabsBefore, 5000);
    const tabsAfterFirst = countPofViewerTabs();

    editor.selection = new vscode.Selection(engineLine, 5, engineLine, 5);
    await vscode.commands.executeCommand("fsoLsp.revealDefinitionOrPofViewer");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(
      countPofViewerTabs(),
      tabsAfterFirst,
      "expected the same POF viewer panel to be reused (no second tab) when F12'ing a different subsystem of the same model",
    );
  });

  test("hovering a $Subsystem: line offers a trusted 'Open 3D view' command link", async () => {
    // Restores mouse-driven access (a DocumentLink-based ctrl+click attempt, removed
    // here, turned out not to work - VSCode's built-in document-link click handler
    // treats a link's target purely as a resource to open, not a command to execute,
    // regardless of scheme; a trusted MarkdownString's command links ARE reliably
    // honored, which a Hover can provide). Hover computation is itself side-effect-free
    // no matter how often it's invoked, so this doesn't reintroduce the "opens on mere
    // hover" bug fixed earlier: nothing happens until the user actually clicks the link
    // inside the tooltip. This test can't simulate a real click on that rendered link,
    // but it does verify (1) the hover exists with a well-formed, trusted command link
    // for the right command/arguments, and (2) invoking that exact command (what
    // clicking the link does) opens the viewer.
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const turretLine = lines.findIndex((l) => l.includes("$Subsystem: turret01"));
    assert.ok(turretLine >= 0, "fixture must contain a $Subsystem: turret01 line");

    const hovers = (await vscode.commands.executeCommand(
      "vscode.executeHoverProvider",
      uri,
      new vscode.Position(turretLine, 2),
    )) as vscode.Hover[];
    const linkHover = hovers.find((h) =>
      h.contents.some((c) => {
        const value = typeof c === "string" ? c : (c as vscode.MarkdownString).value;
        return value.includes("command:fsoLsp.openPofViewerAtPosition");
      }),
    );
    assert.ok(linkHover, `expected a hover offering the 3D-view command link, got: ${JSON.stringify(hovers)}`);
    const markdown = linkHover!.contents.find(
      (c) => typeof c !== "string" && (c as vscode.MarkdownString).value.includes("command:fsoLsp.openPofViewerAtPosition"),
    ) as vscode.MarkdownString;
    assert.ok(markdown.isTrusted, "expected the command-link MarkdownString to be marked isTrusted (required for the link to actually run)");

    // Not asserting on a tab-count *increase*: an earlier test in this suite may have
    // already opened (and left open) the same model's panel, which this would then
    // reuse (see pofViewer.ts's fingerprint()-based dispatch) rather than add a new
    // tab - reuse is the correct, intended behavior, not something to work around here.
    await vscode.commands.executeCommand("fsoLsp.openPofViewerAtPosition", uri.toString(), turretLine);
    const opened = await waitFor(() => countPofViewerTabs() > 0, 5000);
    assert.ok(opened, "expected activating the hover link's target command to open the 3D POF viewer");
  });

  test("hovering a $Subsystem: line whose model is packed in a .vpc archive also offers the 'Open 3D view' link", async () => {
    // Ctrl+click (via a DocumentLink) was tried for this case too, but dropped: VSCode's
    // built-in "open this link" click handler only reliably opens *loose* files that
    // way (a POF packed inside a .vp/.vpc archive has no real file: URI, and every
    // virtual-scheme approach tried - a registered FileSystemProvider, non-zero stat/
    // readFile responses, an explicit workbench.editorAssociations entry - still failed
    // to open via VSCode's default resource-open codepath). The hover-triggered "Open
    // 3D view" link works identically for loose and VP-archived models, since it goes
    // through our own command rather than VSCode's generic resource opener - so that's
    // the only mouse-driven trigger, alongside F12, for either case.
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const pofLine = lines.findIndex((l) => l.includes("vpcmodel.pof"));
    assert.ok(pofLine >= 0, "fixture must contain a ship with $POF file: vpcmodel.pof");
    const vpTurretLine = lines.findIndex((l, i) => i > pofLine && l.includes("$Subsystem: turret01"));
    assert.ok(vpTurretLine >= 0, "fixture must contain the GTF VP Test ship's $Subsystem: turret01 line");

    const hovers = (await vscode.commands.executeCommand(
      "vscode.executeHoverProvider",
      uri,
      new vscode.Position(vpTurretLine, 2),
    )) as vscode.Hover[];
    const linkHover = hovers.find((h) =>
      h.contents.some((c) => {
        const value = typeof c === "string" ? c : (c as vscode.MarkdownString).value;
        return value.includes("command:fsoLsp.openPofViewerAtPosition");
      }),
    );
    assert.ok(linkHover, `expected a hover offering the 3D-view command link even for a VP-archived subsystem, got: ${JSON.stringify(hovers)}`);

    const tabsBefore = countPofViewerTabs();
    await vscode.commands.executeCommand("fsoLsp.openPofViewerAtPosition", uri.toString(), vpTurretLine);
    const opened = await waitFor(() => countPofViewerTabs() > tabsBefore, 5000);
    assert.ok(opened, "expected activating the hover link's target command to open the 3D POF viewer for the VP-archived model");
  });

  test("F12 elsewhere in ships.tbl falls through to normal go-to-definition instead of opening the 3D viewer", async () => {
    const uri = vscode.Uri.file(path.join(fixturesRoot, "data/tables/ships.tbl"));
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);
    await waitForDiagnostics(uri);

    const lines = doc.getText().split(/\r\n|\r|\n/);
    const nameLine = lines.findIndex((l) => l.includes("$Name: GTF Ulysses"));
    assert.ok(nameLine >= 0);

    const tabsBefore = countPofViewerTabs();
    editor.selection = new vscode.Selection(nameLine, 2, nameLine, 2);
    await vscode.commands.executeCommand("fsoLsp.revealDefinitionOrPofViewer");
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

/**
 * Concatenates every registered hover provider's content at this position, not just the
 * first result - VSCode itself stacks all of them into one tooltip, and (since the
 * client's own `$Subsystem:` "Open 3D view" command-link hover was added) more than one
 * provider can legitimately contribute a hover for the same line, in either order.
 */
async function getHoverText(uri: vscode.Uri, line: number): Promise<string> {
  const hovers = (await vscode.commands.executeCommand(
    "vscode.executeHoverProvider",
    uri,
    new vscode.Position(line, 5),
  )) as vscode.Hover[];
  assert.ok(hovers && hovers.length > 0, `expected at least one hover result at line ${line}`);
  return hovers
    .flatMap((h) => h.contents.map((c) => (typeof c === "string" ? c : (c as vscode.MarkdownString).value)))
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
