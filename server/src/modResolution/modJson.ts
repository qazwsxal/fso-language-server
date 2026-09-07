export interface ModJsonDependency {
  id: string;
  version?: string;
}

export interface ModJsonPackage {
  name: string;
  isEnabled?: boolean;
  dependencies?: ModJsonDependency[];
}

export interface ModJson {
  id: string;
  version?: string;
  /**
   * Already-resolved, ordered list of mod ids (self first, then each dependency,
   * highest-priority-first) that Knossos computed for the FSO `-mod` command line.
   * When present this is authoritative - simpler and more reliable than re-deriving the
   * same answer from packages[].dependencies[] ourselves.
   */
  mod_flag?: string[];
  packages?: ModJsonPackage[];
}

export function parseModJson(content: string): ModJson | null {
  try {
    const data = JSON.parse(content);
    if (typeof data?.id !== "string") {
      return null;
    }
    return data as ModJson;
  } catch {
    return null;
  }
}

/**
 * Collects dependency mod ids + version constraints across every enabled package
 * (fallback path for when `mod_flag` isn't present - e.g. a mod.json authored/edited
 * outside Knossos itself), excluding the pseudo-dependency on the "FSO" engine build
 * itself, deduplicated in first-seen order.
 */
export function collectPackageDependencyIds(modJson: ModJson): ModJsonDependency[] {
  const deps: ModJsonDependency[] = [];
  const seen = new Set<string>();

  for (const pkg of modJson.packages ?? []) {
    if (pkg.isEnabled === false) {
      continue;
    }
    for (const dep of pkg.dependencies ?? []) {
      if (dep.id === "FSO" || seen.has(dep.id)) {
        continue;
      }
      seen.add(dep.id);
      deps.push(dep);
    }
  }

  return deps;
}
