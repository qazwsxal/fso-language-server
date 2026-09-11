# Changelog

All notable changes to the "FreeSpace Open Language Server" extension are documented in this file.

## [0.0.1] - Unreleased

Initial packaging for the VS Code Marketplace. Highlights:

- Syntax highlighting for `.tbl`/`.tbm` files.
- Go to Definition across mod-wide cross-references: sounds, loose textures, explosion animations,
  target priority groups, and a ship's/weapon's own layered `$Name:` line.
- Effective definition hover synthesizing a ship's/weapon's fully merged, per-field-provenance
  definition across every applied `.tbl`/`.tbm` layer.
- VP/VPC archive content resolution, including LZ41-compressed entries.
- Interactive 3D POF model viewer with subsystem navigation, now also reachable (F12 and a
  hover "Open 3D view" link) from a weapon's `$Model file:`, `$Tech Model:`, and
  `$External Model File:` lines, and a ship's `$Cockpit POF file:`, `$POF file Techroom:`,
  `$POF target file:`, and `+Generic Debris POF file:` lines, not just a ship's
  `$Subsystem:`/`$POF file:`.
- Knossos-aware mod search-path and load-order resolution.
- Go to Definition, hover, and unresolved-reference diagnostics for several more cross-
  references: a weapon's own `$Armor Type:`, a weapon's `$substitute:` list, a weapon's
  `$Homing:`/proximity-detonation ship-type/ship-class/species/IFF restriction lists, a
  ship's `$Countermeasure type:`, a ship's `$Ship IFF Colors:` `+Seen By:`/`+When IFF
  Is:`, and ship-template support - a ship class's `+Use Template:`/`+Use Ship as
  Template:` now resolve against `#Ship Templates` entries (`$Template:`) and other ship
  classes respectively.
- Added support for three more tables, each backing a cross-reference above: `colors.tbl`
  (a ship's `$Default Team:`), `mflash.tbl` (a weapon's `$Muzzleflash:`), and `ssm.tbl` (a
  weapon's `$SSM:`, by name or numeric index) - each gets Go to Definition, hover, and
  unresolved-reference diagnostics.
- A ship's `$Flags:` list is now validated too - each entry is checked against the
  engine's recognized flag set AND objecttypes.tbl's `#Ship Types` section (an entry
  matching either is fine; only one matching neither is flagged), mirroring the real
  engine's own dual-target check.
 