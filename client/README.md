# FS Tables

Language support for [FreeSpace Open](https://www.hard-light.net/wiki/index.php/FreeSpace_Open) (FSO)
mod table files (`.tbl` / `.tbm`) — syntax highlighting plus a real language server that understands
FSO's `.tbl` + `.tbm` modular-table merge semantics, VP archive contents, and POF model files.

Built against a real Blue Planet Complete + MediaVPs install; every feature below was verified against
that mod, not just synthetic fixtures.

## Features

- **Syntax highlighting** for `.tbl`/`.tbm` grammar (`$Field:`, `+Subfield:`, `@Field:`, `#Section`/`#End`,
  `+nocreate`/`+remove` sentinels).
- **Go to Definition** (F12 / Ctrl+Click) across mod-wide cross-references, including:
  - Sound name/index references (`sounds.tbl`'s Game Sounds section)
  - Texture references (loose files)
  - Ship `$Explosion Animations:` (`fireball.tbl`, including numeric/positional refs)
  - Ship `$Target Priority Groups:` (`objecttypes.tbl`)
  - A ship's/weapon's own `$Name:` line — cycles through every layer (base `.tbl` + every applied
    `.tbm`, in application order) that touched that entry
- **Effective definition hover** on ship/weapon `$Name:` lines — shows the fully merged definition
  across every `.tbl`/`.tbm` layer directly in the hover tooltip, with per-field provenance (which
  file/line won each value).
- **VP archive awareness** — resolves and previews table/text content packed inside `.vp`/`.vpc`
  archives, including FSO's LZ41-compressed entries.
- **3D POF model viewer** — opens a ship's/weapon's `.pof` model in an interactive 3D view, with
  subsystem navigation from the table file.
- **Mod-aware resolution** — understands Knossos `mod.json`/`mod.ini` search paths and dependency
  order (`mod_flag`) so cross-references resolve the same way FSO itself would load them, loose files
  taking precedence over VP-packed ones.

## Requirements

No external dependencies — everything runs bundled inside the extension. For cross-mod features
(go-to-definition, effective-definition view, VP/POF resolution) to find anything, open a file that
lives inside a real FSO mod's folder structure (with a `data/tables` directory and, ideally, a
Knossos-style `mod.json`).

## Known limitations

- The effective definition hover only covers fields this extension's parsers structurally track
  (a large but not exhaustive subset of `ships.tbl`/`weapons.tbl`) — it is a synthesized summary, not
  a byte-perfect reconstruction of FSO's own parser output.
- Texture go-to-definition only resolves loose files, not textures packed inside VP archives.

## Release Notes

See `CHANGELOG.md` in this extension's package for release notes.
