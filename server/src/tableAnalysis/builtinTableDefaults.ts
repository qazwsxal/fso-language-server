/**
 * FSO's compiled-in fallback content for a handful of tables, used by the real engine
 * (`defaults_get_file()`, `code/def_files/def_files.cpp`) whenever NO real file exists
 * anywhere on the actual search path for that table - confirmed as a real, common
 * scenario, not a hypothetical: retail FreeSpace 2's own VP files predate species_defs.tbl/
 * iff_defs.tbl/objecttypes.tbl as moddable tables entirely, so a Knossos-managed install
 * whose dependency chain bottoms out at retail (no mod along the way ships its own copy)
 * has NO real file for any of these three - `resolveFile()` correctly returns null, but
 * this project's merged-table builders had no equivalent fallback, so every cross-
 * reference against a species/IFF/ship-type that only exists via the compiled-in default
 * (e.g. plain "$Species: Terran") was incorrectly reported as unresolved. Ground-truthed
 * directly from `code/def_files/data/tables/*.tbl` in the FSO source (master branch).
 *
 * Only species_defs.tbl and iff_defs.tbl are reproduced verbatim (both small); the real
 * objecttypes.tbl default also carries a large block of AI/fog/etc. tuning per ship type
 * that this project doesn't parse at all (its `#Ship Types` extractor only tracks each
 * entry's `$Name:` - see objectTypesEntries.ts), so BUILTIN_OBJECTTYPES_TBL is a reduced,
 * names-only reconstruction rather than a byte-for-byte copy - functionally identical for
 * this project's one use of it (existence-checking a ship-type name).
 */

export const BUILTIN_SPECIES_DEFS_TBL = `
#SPECIES DEFS

$Species_Name: Terran
$Default IFF: Friendly
$FRED Color: ( 0, 0, 192 )
$AwacsMultiplier: 1.00

$Species_Name: Vasudan
$Default IFF: Friendly
$FRED Color: ( 0, 128, 0 )
$AwacsMultiplier: 1.25

$Species_Name: Shivan
$Default IFF: Hostile
$FRED Color: ( 192, 0, 0 )
$AwacsMultiplier: 1.50

#END
`;

export const BUILTIN_IFF_DEFS_TBL = `
#IFFs

$Traitor IFF: Traitor

$IFF Name: Friendly
$Color: ( 0, 255, 0 )
$Attacks: ( "Hostile" "Neutral" "Traitor" )
$Flags: ( "support allowed" )
$Default Ship Flags: ( "cargo-known" )

$IFF Name: Hostile
$Color: ( 255, 0, 0 )
$Attacks: ( "Friendly" "Neutral" "Traitor" )

$IFF Name: Neutral
$Color: ( 255, 0, 0 )
$Attacks: ( "Friendly" "Traitor" )

$IFF Name: Unknown
$Color: ( 255, 0, 255 )
$Attacks: ( "Hostile" )
$Flags: ( "exempt from all teams at war" )

$IFF Name: Traitor
$Color: ( 255, 0, 0 )
$Attacks: ( "Friendly" "Hostile" "Neutral" "Traitor" )

#End
`;

/** Names-only reconstruction of the real built-in default's `#Ship types` section - see this module's doc comment for why. */
export const BUILTIN_OBJECTTYPES_TBL = `
#Ship types

$Name: Navbuoy
$Name: Sentry Gun
$Name: Escape Pod
$Name: Cargo
$Name: Support
$Name: Fighter
$Name: Bomber
$Name: Transport
$Name: Freighter
$Name: AWACS
$Name: Gas Miner
$Name: Cruiser
$Name: Corvette
$Name: Capital
$Name: Super Cap
$Name: Drydock
$Name: Knossos Device

#End
`;
