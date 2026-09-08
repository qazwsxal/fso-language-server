/** One resolved field value plus which layer set it - the per-field-map analogue of the whole-entry `...Source` pattern used elsewhere in the merged tables. */
export interface FieldMapEntry {
  /** The field's own original casing (e.g. "EngineSnd"), as written by whichever layer last set it - display-only, the map itself is keyed by the lowercased form. */
  field: string;
  value: string;
  source: string;
}

/** Minimal shape shared by ShipTextureRef/WeaponTextureRef (sound and texture refs alike) - just enough to merge by field key. */
export interface NamedFieldRef {
  field: string;
  value: string;
}

/**
 * Merges one layer's flat list of named-field refs (e.g. a ship's `soundRefs`, which
 * covers ~50 independent `$EngineSnd:`/`$GlideStartSnd:`/etc. fields all captured into
 * one array rather than one struct field apiece - see shipEntries.ts/weaponEntries.ts)
 * into a per-field-key map, in place. Only the field keys THIS layer's `refs` actually
 * mentions get overwritten - a later layer's map doesn't need to repeat every value from
 * earlier layers, exactly mirroring how a real `.tbm` only needs to name the fields it's
 * actually changing. Keyed by lowercased field name, since table field keys are
 * case-insensitive everywhere else in this project.
 */
export function applyNamedFieldRefs(target: Map<string, FieldMapEntry>, refs: NamedFieldRef[], source: string): void {
  for (const ref of refs) {
    const field = ref.field.trim();
    target.set(field.toLowerCase(), { field, value: ref.value, source });
  }
}
