# Changelog

All notable changes to the "FreeSpace Open Language Server" extension are documented in this file.

## [0.0.2] - 2026-09-12

Validated end-to-end against several large real-world mods (Blue Planet Complete,
Between the Ashes, Blackwater Operations Dump, Warmachine, The Sixth Seal, The Sixth
Seal 2, Star Fox: Event Horizon, Solaris).

### New settings

- `fsoLsp.unknownFieldSeverity` flags unrecognized `$Field:` names - useful for catching typos.
- `fsoLsp.validationScope` can scan the whole mod, not just open files.

### New table support

- `intel.tbl` (and its legacy name, `species.tbl`).
- `colors.tbl`, `mflash.tbl`, `ssm.tbl`, `curves.tbl`.
- `menu.tbl` (Training/Simulator room screens) - previously skipped entirely.
- `scripting.tbl` Lua is now understood, and flagged if it has a silent-failure gotcha
  FSO itself won't warn about.
- `strings.tbl`/`tstrings.tbl`, `credits.tbl`/`credits-footer.tbl`, `hud_gauges.tbl`,
  and `help.tbl` - previously skipped entirely, now validated.

### New editing features

- 3D model viewer and hover now also work from more model fields (weapon
  tech/external, ship cockpit/target/debris).
- Go to Definition/hover for more fields: weapon armor type, substitute list, homing
  restrictions; ship countermeasure type, IFF colors, flags list.
- Ship template references now resolve.
- Autocomplete suggests field names for `+`/`@` fields too, not just `$`, and covers
  every field this extension already cross-references - model files, countermeasure
  type, default team, muzzleflash, SSM, ship/species/IFF lists, ship templates, and
  briefing icons among them.
- Quick fixes: reorder a field flagged as out of place, insert or remove a missing/stray
  `#End`, and "did you mean X?" suggestions for a mistyped cross-reference (armor type,
  species, IFF, sound, texture, and more).
- Individually-compressed loose model/texture files (`.lz41`) now resolve correctly, not
  just ones packed inside a `.vp`.

### Fewer false warnings

- Briefing icons, quoted values, and BOM-prefixed files no longer break validation.
- ships.tbl, asteroid.tbl, objecttypes.tbl, rank.tbl, medals.tbl, and iff_defs.tbl had
  missing or misfiled fields - fixed.
- mainhall.tbl and cutscenes.tbl weren't validating at all - fixed.
- Several tables that never use a `#Section` header, or close sections in unusual ways,
  no longer flag every line - restoring real validation for `game_settings.tbl`,
  `messages.tbl`, `post_processing.tbl`, `props.tbl`, `traitor.tbl`, `ui.tbl`,
  `nodemap.tbl`, `*-smap.tbm`, and a few SCPUI tables.
- References resolved only through FSO's built-in defaults are no longer flagged missing.
- Fields that legitimately sit after a table's closing marker are no longer flagged.
- Autocomplete for a field name (like `$Mass:`) could silently show nothing depending on
  how much you'd already typed - fixed.
- Autocomplete no longer offers a ship's top-level fields while you're inside a
  `$Subsystem:` block, where they don't apply.

## [0.0.1] - 2026-09-10

Initial packaging for the VS Code Marketplace. Highlights:

- Syntax highlighting for `.tbl`/`.tbm` files.
- Go to Definition across mod-wide cross-references: sounds, loose textures, explosion animations,
  target priority groups, and a ship's/weapon's own layered `$Name:` line.
- Effective definition hover synthesizing a ship's/weapon's fully merged, per-field-provenance
  definition across every applied `.tbl`/`.tbm` layer.
- VP/VPC archive content resolution, including LZ41-compressed entries.
- Interactive 3D POF model viewer with subsystem navigation.
- Knossos-aware mod search-path and load-order resolution.
 