# Changelog

All notable changes to the "FreeSpace Open Language Server" extension are documented in this file.

## [0.0.2] - Unreleased

A deeper validation pass against Between the Ashes with `fsoLsp.unknownFieldSeverity`
turned on drove that install's diagnostic count from 909 down to 399 (effectively all of
it real content in ships.tbl/weapons.tbl); every fix below was ground-truthed against
live FSO C++ source:

- ships.tbl's field list grew further: the `FS2 effect grid/scanline color`/`grid
  density`/`wireframe color` and `Selection Effect`/`HUD Gauge Configs` cluster (shared
  with weapons.tbl), `Impact`/`Collision Physics`, the full death-roll/explosion-effect
  cluster (`Expl Splits Ship`, `Base Death-Roll Time`, `Death FX Explosion Count`, and a
  dozen related fields), `Use Newtonian Dampening`, `EMP Resistance Modifier`/`Piercing
  Damage Draw Limit`/`Path Metadata`/`Passive Lightning Arcs`/`Glowpoint overrides`, and
  more - see ships.ts for the full list.
- objecttypes.tbl's `#Ship Types` field list grew from 3 to 26 entries (`Counts for
  Alone`, `Scannable`, `Warp Pushes`, the `$AI:` block, and more), and iff_defs.tbl
  gained the global `$Accessibility Supported:` and per-entry `$Accessibility Color:`
  fields.
- fireball.tbl's `$Unique ID:` field introduced a new schema concept,
  `unorderedFields`, for a real per-entry field whose position can't safely be
  order-checked with this schema's single-entryKeyField model (it precedes `$Name:` on
  every entry, but the order-reset only fires on `$Name:` - listing it in the normal,
  order-checked field list would flag every entry after the first as "out of order").
- Added full support for a brand new table, **intel.tbl** (`*-intl.tbm`, with `species.tbl`
  as its legacy alias filename) - the tech-room "Intelligence Database" species/event
  entries. This resolves a previously-documented mystery: a real file with this exact
  shape (`$Entry:`/`$Name:`/`$Anim:`/`$AlwaysInTechRoom:`/`$Description:`) had no
  confirmed owner anywhere in this project's prior research; it's actually parsed by
  `code/menuui/techmenu.cpp`, a source file nobody had checked yet.
- Recognized a new section-close-token convention: lightning.tbl's `#Bolts begin`/`#Bolts
  end` and `#Storms begin`/`#Storms end` (a "Begin"/"end" pair, distinct from the
  already-supported "Start"/"End" suffix convention).
- ships.tbl's `$Briefing icon:` fix (see above) also revealed several more Between the
  Ashes-only false positives, all fixed: `$Gravity Const:`/`$Animations:` family fields
  missing from ships.tbl's own schema, asteroid.tbl's drastically incomplete field list,
  rank.tbl's field order, and more (see the "validated against other large mods" entry
  below for the full list from that pass).
- Six more tables/file shapes confirmed to be either unsupported grammar or Lua/SCPUI
  plugin content, not something this parser can represent, and excluded from validation
  rather than left generating structural noise: help.tbl (`*-hlp.tbm`, a context-help
  overlay table using colon-less `+TEXT 334 700 ...`-style fields), ui.tbl/nodemap.tbl/
  `*-smap.tbm` (SCPUI's own tech-room UI/map configuration, no owner in base-engine FSO
  source), props.tbl (a real, confirmed engine table whose optional `#PROP CATEGORIES`
  section has no close token of its own), traitor.tbl (a real, confirmed engine table
  whose two sections never close at all, by design), and `credits-footer.tbl` (the same
  free-scroll-text shape as credits.tbl itself, under a different filename).

Validated against several other large, real-world mods (Between the Ashes, Blackwater
Operations) beyond Blue Planet, surfacing and fixing more real false positives:

- Fixed a real, always-on false positive (not just `unknownFieldSeverity` noise): a
  ship's `$Briefing icon:`/`$Briefing icon with cargo:`/`$Briefing wing icon:`/`$Briefing
  wing icon with cargo:` never has its own value - the real texture name always comes
  from a nested `+Regular:` sub-field - but this extension was reading the raw text after
  the field's own colon as if it were the texture name. This happened to work by
  accident for the common multi-line layout (nothing on the `$Briefing icon:` line
  itself, so there was nothing to misread) but broke for a real, valid layout (`+Regular:`
  on the SAME line, e.g. `$Briefing icon: +Regular: iconapollo`) - the literal text
  "+Regular: iconapollo" was reported as a missing texture. Now resolves the real
  `+Regular:` value in both layouts.
- Ships.tbl's `$Gravity Const:` and `$Animations:`/`$Driven Animations:`/`$Animation
  Moveables:` are real ship-level fields (confirmed against ship.cpp) that happen to
  share a name with real weapons.tbl fields - missing from ships.tbl's own field list,
  they triggered a false "weapons.tbl field, not recognized in ships.tbl" warning on
  every entry that used them.
- asteroid.tbl's field list was missing `Display Name`/`Type`/`Rotational Velocity
  Multiplier`/`Explosion Effect`/`Breakup Delay`/`Expl inner rad`/`Expl outer rad`/`Expl
  damage`/`Expl blast`/`Hitpoints`/`Split`/`Split name`/`Spawn Weight`/`Gravity Const`
  entirely - the five `Expl .../Hitpoints` fields happen to share a name with real
  ships.tbl fields, so a real asteroid.tbl that sets them (as most do) got a false
  "ships.tbl field, not recognized in asteroid.tbl" warning on every single entry, an
  always-on false positive just like the ships.tbl one above. Also stopped flagging
  asteroid.tbl's real `$Impact Explosion Effect:`/`$Impact Explosion:`/`$Impact Explosion
  Radius:` fields, which - like weapons.tbl's `$Player Weapon Precedence:` - genuinely
  sit after the table's own `#End`.
- rank.tbl had `Promotion Text`/`Promotion Voice Base` the wrong way around (confirmed
  against `scoring.cpp`), flagging a real, correctly-ordered rank.tbl as "out of order";
  also added the real `Alt Name`/`Title` fields and recognized `$Promotion Text:` as a
  multi-line (`$end_multi_text`-terminated) field, like `$Description:`.
- medals.tbl was missing `Alt Name`/`Wavefile 1`/`Wavefile 2`/`Wavefile Base`/`Promotion
  Text` (the last shared with rank.tbl, same false-positive pattern as above).
- A ship-formation table's `$Name:` (in a `#Wing Formations` section) is followed by a
  completely bare, sigil-less list of vectors spanning many lines - a real grammar shape
  this extension's line-based parser had no way to represent, so every line of the list
  was flagged as "Unrecognized line". Now recognized and consumed as part of the `$Name:`
  field's own value, matching the real `stuff_vec3d_list()` parsing behavior.

Many more ships.tbl/weapons.tbl cross-references, plus three previously-unsupported
tables that back some of them - all ground-truthed directly against the FSO C++ source
rather than guessed:

- New `fsoLsp.unknownFieldSeverity` setting (`"off"` by default): reports a `$Field:` this
  extension doesn't recognize for the table it's in. Making this setting worth turning on
  required comprehensively expanding several schemas first - a real Blue Planet Complete
  install with it on originally produced ~1800 diagnostics, almost all noise from
  incomplete field lists rather than real typos:
  - `ships.tbl`'s field list grew from ~60 to ~150 entries, mechanically extracted in
    real parse order directly from `ship.cpp` - every ship-level sound field
    (`$EngineSnd:` through `$SubsysExplosionSnd:`), the full `$Warpin `/`$Warpout ` field
    cluster, `$Radar Image 2D:`, `$Glowpoint overrides:`, the `$Thruster Bitmap ...`
    cluster, shield/weapon/hull/subsystem regeneration and repair rates, and more - see
    [server/src/schemas/ships.ts](server/src/schemas/ships.ts) for the full accounting.
    This pass also fixed a latent relative-order bug: `$Trail:`/`$Thruster:` actually
    parse before `$Ship IFF Colors:`/`$Target Priority Groups:`, the reverse of what the
    schema previously said (never triggered by a real file yet, but would have).
  - `weapons.tbl` gained `$Light color:`/`$Light radius:`/`$Light intensity:`.
  - `ai.tbl`'s field list grew from 4 to the full ~50-field set read by
    `parse_ai_class()`, mechanically extracted from `aicode.cpp` in call order.
  - `ai_profiles.tbl` gained a new kind of schema field, `unorderedFields`: this table's
    own source comment says its ~180 tuning fields "can be in any order" (a retry-loop
    parser, not a straight sequential one like ships.tbl's), so listing them in the
    order-checked `fieldOrder` would have traded "unrecognized field" noise for "out of
    order" noise on the same real files. `unorderedFields` fields are recognized (and
    count toward cross-schema ownership) without ever being order-checked.
  - `sounds.tbl` gained `$Template:` (Sound Environments entries), `iff_defs.tbl` gained
    the global `$Traitor IFF:` field, `objecttypes.tbl` gained
    `$Turrets prioritize ship target:`, and `mainhall.tbl` gained the global
    `$Num Resolutions:` field.
  - `cutscenes.tbl` was actually keyed on `$Name:` instead of the real `$Filename:` (the
    same "wrong entryKeyField silently validates nothing" bug found elsewhere in this
    project) - fixed, and gained `$cd:`/`$Always Viewable:`/`$Never Viewable:`/
    `$Custom data:`.
  - After all of the above, the same real Blue Planet Complete install's
    `unknownFieldSeverity` diagnostic count dropped from ~1800 to 44 - matching exactly
    the 44 genuine, independently-verified content issues already known from the
    `"wholeMod"` validation pass below, i.e. zero schema-driven false positives left.
- New `fsoLsp.validationScope` setting: `"openFiles"` (default, unchanged) validates only
  documents you have open; `"wholeMod"` also scans every loose `.tbl`/`.tbm` file across
  the active mod's search path, so cross-reference problems show up in the Problems panel
  even for files nobody has opened yet. Re-scans automatically when a table file changes
  on disk.
- `"wholeMod"` scanning a real, large Blue Planet Complete install (dozens of table files)
  surfaced and fixed a wave of false positives, taking that install from 855 diagnostics
  down to 44 (every remaining one independently verified as a real, missing asset in the
  mod rather than an extension bug):
  - `ships.tbl`'s field list was missing several genuinely real fields (`Alt name`,
    `Cockpit POF file`, `POF file Techroom`, `POF target file`, `POF target LOD`,
    `Default Team`, `Explosion Animations`, `Target Priority Groups`, `Countermeasure
    type`, the four `Briefing icon...` variants, `Ship IFF Colors`), each showing up as a
    false "possibly misplaced" warning; `objecttypes.tbl`'s schema was similarly missing
    `Target Priority Groups` (genuinely shared with ships.tbl).
  - `mainhall.tbl`'s schema keyed entries on `$Name:` and expected a `#Main Halls`
    section - neither ever matches a real file (entries are headerless and keyed by a
    bare `$Main Hall` marker), so it silently validated nothing at all; now fixed and
    active.
  - scripting.tbl/`*-sct.tbm`, strings.tbl/tstrings.tbl/`*-lcl.tbm`/`*-tlc.tbm`,
    credits.tbl/`*-crd.tbm`, and hud_gauges.tbl/`*-hdg.tbm` are no longer validated at
    all - each uses a field/value grammar (embedded Lua, bare `index "string"` pairs,
    free-form scroll text, sigil-less `Key: value` lines) this extension's table parser
    fundamentally can't represent, so every diagnostic on them was noise (one real
    hud_gauges.tbm produced 700+ by itself).
  - game_settings.tbl, messages.tbl, and post_processing.tbl close a section implicitly
    (by the start of a specific next section) rather than with an explicit `#End` -
    likewise now fully excluded from structural validation.
  - ssm.tbl/stars.tbl/mainhall.tbl/nebula.tbl/tips.tbl (all genuinely or routinely
    headerless) and a section whose real close token is `#End <Name>` (prefix style, e.g.
    lighting_profiles.tbl's `#Profiles`/`#END PROFILES`) no longer trip "outside of any
    #Section block" / "not closed with #End".
  - A field value that's entirely one quoted string (e.g. `$Species: "Terran"`) no longer
    keeps its literal quotes, which used to break every cross-reference lookup against it.
  - `species_defs.tbl`/`iff_defs.tbl`/`objecttypes.tbl` now fall back to FSO's own
    compiled-in default content (Terran/Vasudan/Shivan; Friendly/Hostile/Neutral/Unknown/
    Traitor; a base `#Ship types` list) when a mod's entire dependency chain - including
    retail - never ships a real file for one, exactly like the engine does.
  - A weapon's `$Player Weapon Precedence:` (a real field that sits after the weapons
    section's own `#End` in the actual grammar) no longer trips "outside of any #Section
    block".

- Fixed a real false positive found by `"wholeMod"`-scanning a real Blue Planet install: a
  ship/species/IFF/ship-type reference that only resolves via FSO's own compiled-in
  fallback content (`species_defs.tbl`/`iff_defs.tbl`/`objecttypes.tbl` are all tables the
  engine falls back to a built-in default for when a mod's whole dependency chain - often
  true back to retail - never ships a real file) was incorrectly reported as unresolved,
  since this extension had no equivalent fallback of its own. A plain `$Species: Terran`
  with no overriding `-sdf.tbm` anywhere is exactly this case.
- Fixed a plain single-line field value that's entirely one quoted string (e.g. `$Species:
  "Terran"`) keeping its literal quote characters, so it never matched anything in a
  cross-reference lookup even when the reference was perfectly valid.
- Fixed a section whose real close token is `#End <Name>` (a prefix, e.g.
  lighting_profiles.tbl's `#Profiles`/`#END PROFILES` - confirmed against a real Blue
  Planet bp-ltp.tbm) being misread as an unclosed section followed by a bogus new one;
  only the `<Name> End`/`<Name> Start` suffix style (`#Game Sounds Start`/`#Game Sounds
  End`) was recognized before.
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
 