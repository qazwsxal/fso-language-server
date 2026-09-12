import { TableSchema } from "./types";

/**
 * asteroid.tbl / *-ast.tbm schema.
 *
 * fields below is a mechanical, in-source-order extraction of every top-level
 * `$Field:` literal read by `asteroid.cpp`'s per-entry parser (~line 2209-2410),
 * replacing an earlier best-effort guess that was missing `Display Name`/`Type`/
 * `Rotational Velocity Multiplier`/`Explosion Effect`/`Breakup Delay`/`Expl inner rad`/
 * `Expl outer rad`/`Expl damage`/`Expl blast`/`Hitpoints`/`Split` entirely - the last
 * five happen to share a literal name with real ships.tbl fields, so a real Between the
 * Ashes asteroid.tbl (which sets them on every entry) got a false "ships.tbl field, not
 * recognized in asteroid.tbl - possibly misplaced" warning on every single one (this
 * warning fires regardless of `unknownFieldSeverity`, unlike a genuinely-unrecognized
 * field, so this was a real always-on false positive, not just noise under that
 * setting). `Subtype`/`Split`/`Split name` are all repeatable `$`-sigil markers with
 * their own `+POF file:`/`+Min:`/`+Max:` `+`-sigil sub-fields (not order-checked).
 *
 * `$Impact Explosion Effect:`/`$Impact Explosion:`/`$Impact Explosion Radius:` are NOT
 * in this list - like weapons.tbl's `$Player Weapon Precedence:`, they're real
 * top-level fields that sit AFTER the `#Asteroid Types` section's own `#End` (confirmed
 * against `asteroid_parse_tbl()`), so they're handled as a structural exemption in
 * server.ts instead of a per-entry field here.
 */
export const asteroidSchema: TableSchema = {
  name: "asteroid.tbl",
  fileMatch: [/(^|[\\/])asteroid\.tbl$/i, /-ast\.tbm$/i],
  sectionNames: ["Asteroid Types"],
  entryKeyField: "Name",
  fields: [
    "Name",
    "Display Name",
    "Type",
    "POF file1",
    "POF file2",
    "POF file3",
    "Subtype",
    "Detail distance",
    "Max Speed",
    "Rotational Velocity Multiplier",
    "Damage Type",
    "Explosion Effect",
    "Explosion Animations",
    "Explosion Radius Mult",
    "Breakup Delay",
    "Expl inner rad",
    "Expl outer rad",
    "Expl damage",
    "Expl blast",
    "Hitpoints",
    "Split",
    "Split name",
    "Spawn Weight",
    "Gravity Const",
  ],
};
