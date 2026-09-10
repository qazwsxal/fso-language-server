# FS Tables

Language support for [FreeSpace Open](https://www.hard-light.net/wiki/index.php/FreeSpace_Open) (FSO)
mod table files (`.tbl` / `.tbm`) — syntax highlighting plus a language server that understands FSO's
`.tbl`/`.tbm` modular-table merge semantics, VP archive contents, and POF model files.

## Features

- Syntax highlighting for `.tbl`/`.tbm` grammar.
- Go to Definition (F12 / Ctrl+Click) across mod-wide cross-references (sounds, textures, explosion
  animations, target priority groups, layered `$Name:` entries).
- Effective definition hover on ship/weapon `$Name:` lines, merged across every applied `.tbl`/`.tbm`
  layer with per-field provenance.
- VP/VPC archive awareness, including LZ41-compressed entries.
- Interactive 3D POF model viewer with subsystem navigation.
- Knossos-aware mod search-path and load-order resolution.

## Requirements

No external dependencies. For cross-mod features to resolve anything, open a file that lives somewhere
inside a real FSO mod's folder tree (a `data/tables` directory with, somewhere above it, a
Knossos-style `mod.json` or a `mod.ini`).

## Release Notes

See `CHANGELOG.md` in this extension's package.
