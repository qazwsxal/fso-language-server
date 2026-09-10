# FSO Modding Tools

A VS Code extension and language server for FreeSpace Open modding: `.tbl`/`.tbm` tables and `.fs2`/`.fc2` missions.

## Features

- Syntax highlighting for `.tbl`/`.tbm` and `.fs2`/`.fc2`
- Go to Definition / hover across mod-wide cross-references (sounds, textures, ships, weapons, armor, species, and more)
- Effective definition hover — the fully merged value across every applied `.tbl`/`.tbm` layer, with provenance
- Mission cross-linking — ship/weapon references in `.fs2`/`.fc2` resolve into `ships.tbl`/`weapons.tbl` (WIP)
- VP/VPC archive awareness (including LZ41-compressed entries)
- Interactive 3D POF model viewer
- Knossos-aware mod search-path and load-order resolution
