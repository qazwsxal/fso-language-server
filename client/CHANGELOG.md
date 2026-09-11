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

- Fixed a broad false-positive source: a plain single-line field value that's entirely
  one quoted string (e.g. `$Species: "Terran"`) kept its literal quote characters, so it
  never matched anything in a cross-reference lookup (species_defs.tbl, texture indexes,
  ...) even when the reference was perfectly valid. Found via `"wholeMod"` scanning a real
  Blue Planet install.
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
 