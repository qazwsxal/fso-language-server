# Changelog

All notable changes to the "FreeSpace Open Language Server" extension are documented in this file.

## [0.0.2] - Unreleased

This release was validated against several large real-world mods (Blue Planet Complete,
Between the Ashes, Blackwater Operations Dump) end-to-end, not just synthetic examples -
each one surfaced real false positives that are now fixed, and the schemas behind ships.tbl
and weapons.tbl in particular are far more complete as a result.

- New `intel.tbl` support (also recognized under its legacy filename `species.tbl`) - the
  tech-room "Intelligence Database" species/event entries now get the same validation as
  other tables.
- New `fsoLsp.unknownFieldSeverity` setting (off by default): turn it on to have the
  extension flag any `$Field:` it doesn't recognize for the table it's in - handy for
  catching typos in your own table edits. It was kept off by default until the built-in
  field lists were comprehensive enough not to flag real, valid fields as typos; ships.tbl,
  weapons.tbl, ai.tbl, ai_profiles.tbl, and several smaller tables have all been
  substantially expanded to get there.
- New `fsoLsp.validationScope` setting: `"openFiles"` (default, unchanged) validates only
  documents you have open; `"wholeMod"` also scans every loose `.tbl`/`.tbm` file across
  the active mod's search path, so cross-reference problems show up in the Problems panel
  even for files nobody has opened yet. Re-scans automatically when a table file changes
  on disk.
- Three new tables supported, each with Go to Definition, hover, and unresolved-reference
  checking: `colors.tbl` (a ship's default team color), `mflash.tbl` (a weapon's muzzle
  flash), and `ssm.tbl` (a weapon's SSM strike, by name or number).
- Fixed a ship's `$Briefing icon:` (and its "with cargo"/wing variants) reporting its own
  sub-field text as a missing texture when written on a single line (e.g.
  `$Briefing icon: +Regular: iconapollo`) - a real, valid layout used by some mods.
- Fixed several real ships.tbl/weapons.tbl fields being flagged as "belongs to a different
  table" purely because they happened to share a name with a field in another table:
  ships.tbl's gravity, animation, and death-roll/explosion-effect fields; asteroid.tbl's
  explosion and hitpoint fields (previously missing from its schema almost entirely,
  causing this on nearly every entry); objecttypes.tbl's `#Ship Types` fields (schema grew
  from 3 recognized fields to 26); and several more.
- Fixed rank.tbl flagging correctly-written files as having fields "out of order" (two
  fields were listed backwards); medals.tbl and iff_defs.tbl were also missing several
  real fields.
- Fixed a ship-formation table's (`#Wing Formations`) list of positions - written as a
  bare block of numbers with no field name of its own - being flagged as unrecognized
  content on every line.
- Recognized a second style of section-closing marker (lightning.tbl's `#Bolts begin`/
  `#Bolts end` style, alongside the already-supported `Start`/`End` style).
- `scripting.tbl`/`*-sct.tbm` (embedded Lua scripts and hooks) is now properly
  understood instead of producing noise on every line: an embedded Lua block is
  recognized and skipped over correctly, tested against dozens of real scripts across
  several mods. As a bonus, since FSO's own table-comment handling doesn't know it's
  reading Lua, it's easy to accidentally trip it from inside a script without any error
  from the game - a stray `;` outside a quoted string silently discards the rest of that
  line (even Lua's own optional `;` statement separator, or a `;` inside a single-quoted
  Lua string, triggers this - FSO only tracks double quotes), and `/*`/`!*` anywhere in
  the file - including inside Lua, which never uses either sequence - starts a comment
  that silently swallows everything up to the next matching closer, possibly much later
  in an unrelated table. This extension now warns about both, so a mistake like this
  doesn't have to be discovered the hard way in-game. (A version-tag-gated comment block,
  a real and intentional pattern some scripts use to make code conditional on the engine
  version, is recognized and worded accordingly rather than flagged as a likely mistake.)
- A batch of tables that use a grammar this extension's table parser fundamentally can't
  represent (sigil-less key/value lines, free-form scroll text, or sections that never
  close, mostly used by scripting/UI plugins rather than the base game) are no longer
  validated at all, so they stop generating irrelevant warnings: `strings.tbl`/
  `tstrings.tbl`, `credits.tbl` and `credits-footer.tbl`, `hud_gauges.tbl`,
  `game_settings.tbl`, `messages.tbl`, `post_processing.tbl`, `help.tbl`, `ui.tbl`,
  `nodemap.tbl`, `*-smap.tbm` system-map files, `props.tbl`, and `traitor.tbl`.
- Fixed several tables that never trip a `#Section` header at all in practice (`ssm.tbl`,
  `stars.tbl`, `mainhall.tbl`, `nebula.tbl`, `tips.tbl`) incorrectly warning about every
  field being outside a section.
- Fixed `mainhall.tbl` silently validating nothing at all (it was looking for the wrong
  section name and entry format); it's now fully active.
- Fixed `cutscenes.tbl` silently validating nothing at all (it was keyed on the wrong
  field); it now also recognizes several real fields it was missing.
- Fixed a table file starting with a UTF-8 byte-order mark (common from Windows editors)
  having its first `#Section` header silently ignored, incorrectly flagging every field in
  the file.
- Fixed a field value written as a single quoted string (e.g. `$Species: "Terran"`) keeping
  its literal quote marks, which broke lookups against it even when the reference was
  valid.
- Fixed a section closed with the pattern `#End <Name>` (used by a few tables, e.g.
  lighting_profiles.tbl) being misread as unclosed.
- Fixed `species_defs.tbl`, `iff_defs.tbl`, and `objecttypes.tbl` references (species, IFF,
  and ship-type names) being reported as unresolved when a mod relies on FreeSpace's own
  built-in defaults for these tables instead of shipping its own file - matching how the
  game itself behaves.
- Fixed a weapon's `$Player Weapon Precedence:` and asteroid.tbl's impact-explosion fields
  (which legitimately appear after the table's closing `#End`) being flagged as outside
  any section.
- The 3D POF model viewer (F12 and the hover "Open 3D view" link) now also opens from a
  weapon's `$Tech Model:`/`$External Model File:` lines and a ship's `$Cockpit POF file:`/
  `$POF file Techroom:`/`$POF target file:`/`+Generic Debris POF file:` lines, not just the
  main model fields. Hovering one of these now shows a focused status for that field
  instead of the full merged entry.
- Go to Definition, hover, and unresolved-reference checking for several previously-
  untracked references: a weapon's `$Armor Type:`, `$substitute:` list, and
  `$Homing:`/proximity-detonation restriction lists; a ship's `$Countermeasure type:`,
  `$Ship IFF Colors:`, and `$Flags:` list.
- Ship template support: a ship class's `+Use Template:`/`+Use Ship as Template:` now
  resolve to the right place.

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
 