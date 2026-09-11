# Changelog

All notable changes to the "FreeSpace Open Language Server" extension are documented in this file.

## [0.0.2] - Unreleased

Many more ships.tbl/weapons.tbl cross-references, plus three previously-unsupported
tables that back some of them - all ground-truthed directly against the FSO C++ source
rather than guessed:

- The 3D POF model viewer (F12 and a hover "Open 3D view" link) now also opens from a
  weapon's `$Model file:`, `$Tech Model:`, and `$External Model File:` lines, and a
  ship's `$Cockpit POF file:`, `$POF file Techroom:`, `$POF target file:`, and
  `+Generic Debris POF file:` lines - not just a ship's `$Subsystem:`/`$POF file:`.
  Hovering directly over one of these lines shows a focused status for just that field
  instead of the full effective-entry dump.
- Go to Definition, hover, and unresolved-reference diagnostics for a batch of previously-
  untracked cross-references: a weapon's own `$Armor Type:` (distinct from `$Damage
  Type:`), a weapon's `$substitute:` list, a weapon's `$Homing:`/proximity-detonation
  ship-type/ship-class/species/IFF restriction lists, a ship's `$Countermeasure type:`,
  a ship's `$Ship IFF Colors:` `+Seen By:`/`+When IFF Is:`, and a ship's `$Flags:` list
  (validated against the engine's recognized flag set OR objecttypes.tbl's `#Ship Types`
  section, mirroring the real engine's own dual-target check so legitimate flags don't
  false-positive).
- Ship-template support: a ship class's `+Use Template:`/`+Use Ship as Template:` now
  resolve against `#Ship Templates` entries (`$Template:`) and other ship classes
  respectively.
- Three new tables, each backing a cross-reference above: `colors.tbl` (a ship's
  `$Default Team:`), `mflash.tbl` (a weapon's `$Muzzleflash:`), and `ssm.tbl` (a weapon's
  `$SSM:`, by name or numeric index) - each gets Go to Definition, hover, and unresolved-
  reference diagnostics.

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
 