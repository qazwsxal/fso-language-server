# FSO Language Server

A VS Code extension and language server for FreeSpace Open modding: `.tbl`/`.tbm` tables and `.fs2`/`.fc2` missions.

## Features

- Syntax highlighting for `.tbl`/`.tbm` and `.fs2`/`.fc2`
- Go to Definition / hover across mod-wide cross-references (sounds, textures, ships, weapons, armor, species, and more)
- Effective definition hover — the fully merged value across every applied `.tbl`/`.tbm` layer, with provenance
- Mission cross-linking — ship/weapon references in `.fs2`/`.fc2` resolve into `ships.tbl`/`weapons.tbl` (WIP)
- VP/VPC archive awareness (including LZ41-compressed entries)
- Interactive 3D POF model viewer
- Knossos-aware mod search-path and load-order resolution

## Thanks

This implementation was informed by the following projects' documentation, formats, and behavior:

- [mjn's FSO Tables](https://github.com/MjnMixael/FSO-Table-Syntax-Extension) — an earlier VS Code
  syntax extension for FSO table/mission files.
- [pof-tools](https://github.com/Baezon/pof-tools) — a reference for POF model structure and conventions.
- The [FreeSpace Open source code project](https://github.com/scp-fs2open/fs2open.github.com) — the
  ground truth for table-parsing and POF-format behavior throughout this project.
- [Knossos.NET](https://github.com/KnossosNET/Knossos.NET) — for mod search-path/dependency
  resolution semantics.
