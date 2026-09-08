/**
 * FSO's `$Name:` convention: a leading `@` hides the entry from tech-room listings but
 * is NOT part of the actual name used for matching elsewhere (ship `$Default PBanks:`/
 * `$Default SBanks:` weapon-name lists, `$Species:`, etc. all reference the bare name).
 * Confirmed against a real Blue Planet bp-wep.tbm: 24 of 288 weapon entries are named
 * `@Subach HL-7`/`@Rockeye`/etc., but ships' bank lists reference them as plain
 * `"Subach HL-7"`/`"Rockeye"` with no `@` - matching on the raw `$Name:` value (as an
 * earlier version of this cross-reference did) produced false "not found" warnings on
 * some of the most common weapons in the mod. Strip once, not repeatedly - a name is
 * never expected to carry more than one leading `@`.
 */
export function stripHiddenNamePrefix(name: string): string {
  return name.startsWith("@") ? name.slice(1) : name;
}
