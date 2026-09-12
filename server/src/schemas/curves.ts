import { TableSchema } from "./types";

/**
 * curves.tbl / *-crv.tbm schema - named animation-curve definitions referenced by
 * numeric index elsewhere in the tables.
 *
 * Confirmed against `code/math/curve.cpp`'s `parse_curve_table()`: the file is
 * `required_string("#Curves")` followed by a `while (optional_string("$Name:"))` loop,
 * i.e. every entry is keyed by `$Name:`. Immediately after the name is read,
 * `Curve::ParseData()` does `required_string("$Keyframes:")` unconditionally - so
 * `$Name:` is always first and `$Keyframes:` always follows it directly, with no other
 * fields in between and no optional reordering.
 */
export const curvesSchema: TableSchema = {
  name: "curves.tbl",
  fileMatch: [/(^|[\\/])curves\.tbl$/i, /-crv\.tbm$/i],
  sectionNames: ["Curves"],
  entryKeyField: "Name",
  fieldOrder: ["Name", "Keyframes"],
};
