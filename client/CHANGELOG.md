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
  `$External Model File:` lines, not just a ship's `$Subsystem:`/`$POF file:`.
- Knossos-aware mod search-path and load-order resolution.
 