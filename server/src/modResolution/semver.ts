/** Minimal pseudo-semver support for Knossos-style version constraints (e.g. "~4.6.8", "^2.1.0", ">=1.0.0"). */

function parseVersion(version: string): number[] {
  return version
    .trim()
    .split(".")
    .map((part) => {
      const n = parseInt(part, 10);
      return Number.isNaN(n) ? 0 : n;
    });
}

/** Compares two version strings component-wise; missing components are treated as 0. Returns -1/0/1. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff < 0 ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Checks whether `version` satisfies a Knossos-style constraint string. Supports the
 * common prefixes: `~X.Y.Z` (same major.minor, >= given patch), `^X.Y.Z` (same major,
 * >= given minor.patch), `>=`/`>`/`<=`/`<`, `=`/bare (exact match). Unrecognized/empty
 * constraints are treated as "anything satisfies" rather than rejecting a candidate.
 */
export function satisfiesConstraint(version: string, constraint: string | undefined): boolean {
  if (!constraint || constraint.trim().length === 0) {
    return true;
  }
  const trimmed = constraint.trim();

  if (trimmed.startsWith("~")) {
    const target = parseVersion(trimmed.slice(1));
    const v = parseVersion(version);
    return v[0] === target[0] && v[1] === target[1] && compareVersions(version, trimmed.slice(1)) >= 0;
  }
  if (trimmed.startsWith("^")) {
    const target = parseVersion(trimmed.slice(1));
    const v = parseVersion(version);
    return v[0] === target[0] && compareVersions(version, trimmed.slice(1)) >= 0;
  }
  if (trimmed.startsWith(">=")) {
    return compareVersions(version, trimmed.slice(2)) >= 0;
  }
  if (trimmed.startsWith("<=")) {
    return compareVersions(version, trimmed.slice(2)) <= 0;
  }
  if (trimmed.startsWith(">")) {
    return compareVersions(version, trimmed.slice(1)) > 0;
  }
  if (trimmed.startsWith("<")) {
    return compareVersions(version, trimmed.slice(1)) < 0;
  }
  if (trimmed.startsWith("=")) {
    return compareVersions(version, trimmed.slice(1)) === 0;
  }
  return compareVersions(version, trimmed) === 0;
}

/** Picks the highest version among candidates that satisfies the constraint, falling back to the highest overall if none do. */
export function pickBestVersion<T>(
  candidates: T[],
  getVersion: (c: T) => string,
  constraint: string | undefined,
): T | null {
  if (candidates.length === 0) {
    return null;
  }
  const satisfying = candidates.filter((c) => satisfiesConstraint(getVersion(c), constraint));
  const pool = satisfying.length > 0 ? satisfying : candidates;
  return pool.reduce((best, c) => (compareVersions(getVersion(c), getVersion(best)) > 0 ? c : best));
}
