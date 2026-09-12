# Changelog

All notable changes to the "FreeSpace Open Language Server" extension are documented in this file.

## [0.0.2] - Unreleased

Many more ships.tbl/weapons.tbl cross-references, plus three previously-unsupported
tables that back some of them - all ground-truthed directly against the FSO C++ source
rather than guessed:

- New `fsoLsp.validationScope` setting: `"openFiles"` (default, unchanged) validates only
  documents you have open; `"wholeMod"` also scans every loose `.tbl`/`.tbm` file across
  the active mod's search path, so cross-reference problems show up in the Problems panel
  even for files nobody has opened yet. Re-scans automatically when a table file changes
  on disk.
- `"wholeMod"` scanning a real, large Blue Planet Complete install (dozens of table files)
  surfaced and fixed a wave of false positives, taking that install from 855 diagnostics
  down to 44 (every remaining one independently verified as a real, missing asset in the
  mod rather than an extension bug):
  - `ships.tbl`'s field list was missing several genuinely real fields (`Alt name`,
    `Cockpit POF file`, `POF file Techroom`, `POF target file`, `POF target LOD`,
    `Default Team`, `Explosion Animations`, `Target Priority Groups`, `Countermeasure
    type`, the four `Briefing icon...` variants, `Ship IFF Colors`), each showing up as a
    false "possibly misplaced" warning; `objecttypes.tbl`'s schema was similarly missing
    `Target Priority Groups` (genuinely shared with ships.tbl).
  - `mainhall.tbl`'s schema keyed entries on `$Name:` and expected a `#Main Halls`
    section - neither ever matches a real file (entries are headerless and keyed by a
    bare `$Main Hall` marker), so it silently validated nothing at all; now fixed and
    active.
  - scripting.tbl/`*-sct.tbm`, strings.tbl/tstrings.tbl/`*-lcl.tbm`/`*-tlc.tbm`,
    credits.tbl/`*-crd.tbm`, and hud_gauges.tbl/`*-hdg.tbm` are no longer validated at
    all - each uses a field/value grammar (embedded Lua, bare `index "string"` pairs,
    free-form scroll text, sigil-less `Key: value` lines) this extension's table parser
    fundamentally can't represent, so every diagnostic on them was noise (one real
    hud_gauges.tbm produced 700+ by itself).
  - game_settings.tbl, messages.tbl, and post_processing.tbl close a section implicitly
    (by the start of a specific next section) rather than with an explicit `#End` -
    likewise now fully excluded from structural validation.
  - ssm.tbl/stars.tbl/mainhall.tbl/nebula.tbl/tips.tbl (all genuinely or routinely
    headerless) and a section whose real close token is `#End <Name>` (prefix style, e.g.
    lighting_profiles.tbl's `#Profiles`/`#END PROFILES`) no longer trip "outside of any
    #Section block" / "not closed with #End".
  - A field value that's entirely one quoted string (e.g. `$Species: "Terran"`) no longer
    keeps its literal quotes, which used to break every cross-reference lookup against it.
  - `species_defs.tbl`/`iff_defs.tbl`/`objecttypes.tbl` now fall back to FSO's own
    compiled-in default content (Terran/Vasudan/Shivan; Friendly/Hostile/Neutral/Unknown/
    Traitor; a base `#Ship types` list) when a mod's entire dependency chain - including
    retail - never ships a real file for one, exactly like the engine does.
  - A weapon's `$Player Weapon Precedence:` (a real field that sits after the weapons
    section's own `#End` in the actual grammar) no longer trips "outside of any #Section
    block".

- Fixed a real false positive found by `"wholeMod"`-scanning a real Blue Planet install: a
  ship/species/IFF/ship-type reference that only resolves via FSO's own compiled-in
  fallback content (`species_defs.tbl`/`iff_defs.tbl`/`objecttypes.tbl` are all tables the
  engine falls back to a built-in default for when a mod's whole dependency chain - often
  true back to retail - never ships a real file) was incorrectly reported as unresolved,
  since this extension had no equivalent fallback of its own. A plain `$Species: Terran`
  with no overriding `-sdf.tbm` anywhere is exactly this case.
- Fixed a plain single-line field value that's entirely one quoted string (e.g. `$Species:
  "Terran"`) keeping its literal quote characters, so it never matched anything in a
  cross-reference lookup even when the reference was perfectly valid.
- Fixed a section whose real close token is `#End <Name>` (a prefix, e.g.
  lighting_profiles.tbl's `#Profiles`/`#END PROFILES` - confirmed against a real Blue
  Planet bp-ltp.tbm) being misread as an unclosed section followed by a bogus new one;
  only the `<Name> End`/`<Name> Start` suffix style (`#Game Sounds Start`/`#Game Sounds
  End`) was recognized before.
- scripting.tbl/`*-sct.tbm` (embedded Lua) and strings.tbl/tstrings.tbl/`*-lcl.tbm`/
  `*-tlc.tbm` (a bare `<index> "string"` format, no `$`/`+` fields at all) are no longer
  validated at all - neither uses this extension's table grammar, so every diagnostic on
  them was noise.
- Fixed "outside of any #Section block" false positives:
  - A table file starting with a UTF-8 byte-order mark (common from Windows editors) had
    its own `#Section` header silently misread as ordinary content, so every field in the
    file was incorrectly flagged.
  - ssm.tbl/`*-ssm.tbm` (never has a `#Section` header at all) and stars.tbl/`*-str.tbm`
    (every header is optional, so a modular patch routinely omits them - confirmed against
    a real Blue Planet bp2-str.tbm) no longer get that same warning on every entry.
- The 3D POF model viewer (F12 and a hover "Open 3D view" link) now also opens from:
  - A weapon's `$Model file:`, `$Tech Model:`, and `$External Model File:` lines.
  - A ship's `$Cockpit POF file:`, `$POF file Techroom:`, `$POF target file:`, and
    `+Generic Debris POF file:` lines - not just a ship's `$Subsystem:`/`$POF file:`.
  - Hovering directly over one of these lines shows a focused status for just that field
    instead of the full effective-entry dump.
- Go to Definition, hover, and unresolved-reference diagnostics for a batch of previously-
  untracked cross-references:
  - A weapon's own `$Armor Type:` (distinct from `$Damage Type:`).
  - A weapon's `$substitute:` list.
  - A weapon's `$Homing:`/proximity-detonation ship-type/ship-class/species/IFF
    restriction lists.
  - A ship's `$Countermeasure type:`.
  - A ship's `$Ship IFF Colors:` `+Seen By:`/`+When IFF Is:`.
  - A ship's `$Flags:` list, validated against the engine's recognized flag set OR
    objecttypes.tbl's `#Ship Types` section (mirroring the real engine's own dual-target
    check so legitimate flags don't false-positive).
- Ship-template support: a ship class's `+Use Template:`/`+Use Ship as Template:` now
  resolve against `#Ship Templates` entries (`$Template:`) and other ship classes
  respectively.
- Three new tables, each backing a cross-reference above:
  - `colors.tbl` (a ship's `$Default Team:`)
  - `mflash.tbl` (a weapon's `$Muzzleflash:`)
  - `ssm.tbl` (a weapon's `$SSM:`, by name or numeric index)
  - Each gets Go to Definition, hover, and unresolved-reference diagnostics.

## [0.0.1] - Unreleased

Initial packaging for the VS Code Marketplace. Highlights:

- Syntax highlighting for `.tbl`/`.tbm` files.
- Go to Definition across mod-wide cross-references: sounds, loose textures, explosion animations,
  target priority groups, and a ship's/weapon's own layered `$Name:` line.
- Effective definition hover synthesizing a ship's/weapon's fully merged, per-field-provenance
  definition across every applied `.tbl`/`.tbm` layer.
- VP/VPC archive content resolution, including LZ41-compressed entries.
- Interactive 3D POF model viewer with subsystem navigation.
- Knossos-aware mod search-path and load-order resolution.
 