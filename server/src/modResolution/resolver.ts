import * as fs from "fs";
import * as path from "path";
import { parseModIni } from "./modIni";
import { parseModJson, collectPackageDependencyIds, ModJson } from "./modJson";
import { pickBestVersion } from "./semver";
import { readVpIndex, readVpEntry, findVpEntry, isVpArchiveFilename, VpArchive } from "../vp/reader";

export interface ResolvedFile {
  kind: "loose" | "vp";
  /** Absolute path to the loose file, or to the .vp archive containing the entry. */
  containerPath: string;
  /** Path within the archive, only set for kind "vp". */
  entryPath?: string;
}

const vpIndexCache = new Map<string, VpArchive>();

function getVpIndex(vpPath: string): VpArchive | null {
  const cached = vpIndexCache.get(vpPath);
  if (cached) {
    return cached;
  }
  try {
    const archive = readVpIndex(vpPath);
    vpIndexCache.set(vpPath, archive);
    return archive;
  } catch {
    return null;
  }
}

/** Drops all cached VP index reads, so a changed/rebuilt .vp is re-read on next access. */
export function clearVpIndexCache(): void {
  vpIndexCache.clear();
}

interface ModRootLocation {
  dir: string;
  kind: "modjson" | "modini";
}

/**
 * Walks up from a file's directory looking for a mod root, preferring `mod.json`
 * (Knossos - the modern, dominant convention) over `mod.ini` (the older FSO-engine-
 * native convention) at whichever directory level either is found first. Returns null
 * if neither is found (e.g. editing a table in a bare/retail tree with no mod metadata
 * at all).
 */
function findModRootLocation(startPath: string): ModRootLocation | null {
  let dir = fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
  const rootDir = path.parse(dir).root;

  while (true) {
    if (fs.existsSync(path.join(dir, "mod.json"))) {
      return { dir, kind: "modjson" };
    }
    if (fs.existsSync(path.join(dir, "mod.ini"))) {
      return { dir, kind: "modini" };
    }
    if (dir === rootDir) {
      return null;
    }
    dir = path.dirname(dir);
  }
}

/** Walks up from a file's directory looking specifically for a mod.ini (see fso-mod-load-order). */
export function findModRoot(startPath: string): string | null {
  const location = findModRootLocation(startPath);
  return location?.kind === "modini" ? location.dir : null;
}

/**
 * Finds the installed folder for a Knossos mod id under `libraryRoot` (the directory
 * containing every versioned mod folder, e.g. `.../FS2/`), picking among any
 * `<id>-<version>` sibling folders via pickBestVersion() against `versionConstraint` -
 * see that function's doc comment for exactly how an unsatisfied constraint is handled
 * (returns null, mirroring Knossos.NET's own dependency resolution, rather than
 * silently substituting some other installed version). No constraint at all means "any
 * version will do" and picks the highest installed, same as Knossos.
 */
function resolveModIdToFolder(libraryRoot: string, id: string, versionConstraint?: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(libraryRoot);
  } catch {
    return null;
  }

  const candidates = entries
    .filter((name) => name === id || name.startsWith(`${id}-`))
    .map((name) => {
      const dir = path.join(libraryRoot, name);
      const modJsonPath = path.join(dir, "mod.json");
      let version = name.slice(id.length + 1); // fallback: parse from folder name suffix
      try {
        const parsed = parseModJson(fs.readFileSync(modJsonPath, "utf8"));
        if (parsed?.version) {
          version = parsed.version;
        }
      } catch {
        // No mod.json (or unreadable) - fall back to the folder-name-derived version above.
      }
      return { dir, version };
    });

  const best = pickBestVersion(candidates, (c) => c.version, versionConstraint);
  return best?.dir ?? null;
}

/**
 * Builds the ordered, highest-to-lowest-priority search path from a Knossos mod.json,
 * per feedback: mod.json is treated as the source of truth for dependency resolution
 * now that virtually all mods target Knossos, with mod.ini kept only as a fallback for
 * older/non-Knossos mods (see buildSearchPath()). Prefers `mod_flag` (Knossos's own
 * already-resolved, ordered id list - self first) when present; otherwise falls back to
 * deriving the same thing from packages[].dependencies[] version constraints via
 * pseudo-semver matching. The library root itself (the directory holding every
 * installed mod, which conventionally also holds the base game's own Root_fs2.vp) is
 * appended last, mirroring mod.ini's install-root fallback.
 */
function buildSearchPathFromModJson(modRootDir: string): string[] | null {
  let modJson: ModJson | null;
  try {
    modJson = parseModJson(fs.readFileSync(path.join(modRootDir, "mod.json"), "utf8"));
  } catch {
    return null;
  }
  if (!modJson) {
    return null;
  }

  const libraryRoot = path.dirname(modRootDir);
  const dirs: string[] = [];
  const seen = new Set<string>();
  const push = (d: string) => {
    const resolved = path.resolve(d);
    if (!seen.has(resolved) && fs.existsSync(resolved)) {
      seen.add(resolved);
      dirs.push(resolved);
    }
  };

  if (modJson.mod_flag && modJson.mod_flag.length > 0) {
    // mod_flag is just a bare, unversioned id list - it says "MVPS belongs on the
    // search path" but not "which installed MVPS-* version". The real version
    // constraint (e.g. "~4.6.8") only lives in packages[].dependencies[], so it has to
    // be cross-referenced here too, or resolveModIdToFolder() falls back to "highest
    // installed version" and can silently pick a newer-than-intended dependency (e.g.
    // MVPS-5.0.2 when the mod actually targets ~4.6.8) - confirmed against a real
    // Blue Planet Complete 3.3.3 install with multiple MVPS-* versions on disk.
    const constraintById = new Map(collectPackageDependencyIds(modJson).map((dep) => [dep.id, dep.version]));
    for (const id of modJson.mod_flag) {
      if (id === "FSO") {
        continue;
      }
      const dir = id === modJson.id ? modRootDir : resolveModIdToFolder(libraryRoot, id, constraintById.get(id));
      if (dir) {
        push(dir);
      }
    }
  } else {
    push(modRootDir);
    for (const dep of collectPackageDependencyIds(modJson)) {
      const dir = resolveModIdToFolder(libraryRoot, dep.id, dep.version);
      if (dir) {
        push(dir);
      }
    }
  }

  push(libraryRoot);
  return dirs;
}

/**
 * Builds the mod.ini-based search path (primarylist -> this mod -> secondarylist ->
 * install root), per fso-mod-load-order. Kept as the fallback for mods that don't
 * (yet) have a mod.json.
 */
function buildSearchPathFromModIni(modRoot: string): string[] {
  const installRoot = path.dirname(modRoot);
  const iniContent = fs.readFileSync(path.join(modRoot, "mod.ini"), "utf8");
  const { primarylist, secondarylist } = parseModIni(iniContent);

  const dirs: string[] = [];
  const seen = new Set<string>();
  const push = (d: string) => {
    const resolved = path.resolve(d);
    if (!seen.has(resolved) && fs.existsSync(resolved)) {
      seen.add(resolved);
      dirs.push(resolved);
    }
  };

  for (const name of primarylist) {
    push(path.join(installRoot, name));
  }
  push(modRoot);
  for (const name of secondarylist) {
    push(path.join(installRoot, name));
  }
  push(installRoot);

  return dirs;
}

/**
 * Keyed by the resolved mod root directory (or the bare containing directory when no
 * mod.json/mod.ini is found at all), not by the individual file passed to
 * buildSearchPath() - every file in the same mod shares one entry. Critical for
 * performance: a real Knossos mod's mod.json can be several megabytes (Blue Planet's is
 * ~3.4MB), and buildSearchPath() is called multiple times per validation pass (once per
 * diagnostic check, and per ship/weapon entry within those) - without this cache, a
 * multi-MB JSON.parse was happening repeatedly on every single keystroke, which is what
 * made texture/damage-type diagnostics feel "extremely slow to update" in practice.
 * Cleared alongside the other resolution caches in server.ts on any watched mod.json/
 * mod.ini change.
 */
const searchPathCache = new Map<string, string[]>();

/** Drops the cached search-path resolution for every mod root, so an edited mod.json/mod.ini is re-read on next access. */
export function clearSearchPathCache(): void {
  searchPathCache.clear();
}

/**
 * Builds the ordered, highest-to-lowest-priority list of directories that make up the
 * effective search path for the mod containing `startPath`. Prefers a mod.json
 * (Knossos) at whichever directory level is found first while walking up; falls back
 * to mod.ini if only that's present. Returns just `[startPath's containing dir]` if
 * neither is found (e.g. editing directly in a bare retail tree).
 */
export function buildSearchPath(startPath: string): string[] {
  const location = findModRootLocation(startPath);
  const cacheKey = location?.dir ?? (fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath));

  const cached = searchPathCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const dirs = computeSearchPath(startPath, location);
  searchPathCache.set(cacheKey, dirs);
  return dirs;
}

function computeSearchPath(startPath: string, location: ModRootLocation | null): string[] {
  if (!location) {
    const dir = fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
    return [dir];
  }

  if (location.kind === "modjson") {
    const dirs = buildSearchPathFromModJson(location.dir);
    if (dirs && dirs.length > 0) {
      return dirs;
    }
  }

  return buildSearchPathFromModIni(location.dir);
}

/**
 * Resolves a single relative path (e.g. "data/tables/ships.tbl") against a search-path
 * directory list, per fso-mod-load-order's within-a-directory precedence: a loose file
 * wins over any .vp archive in that same directory, and .vp archives in a directory are
 * searched in alphabetical order. Returns the first match across the whole ordered
 * directory list, or null if nothing matches anywhere.
 */
export function resolveFile(searchDirs: string[], relativePath: string): ResolvedFile | null {
  const normalizedRelative = relativePath.replace(/\\/g, "/");

  for (const dir of searchDirs) {
    const loosePath = path.join(dir, ...normalizedRelative.split("/"));
    if (fs.existsSync(loosePath) && fs.statSync(loosePath).isFile()) {
      return { kind: "loose", containerPath: loosePath };
    }

    let vpFiles: string[] = [];
    try {
      vpFiles = fs
        .readdirSync(dir)
        .filter((f) => isVpArchiveFilename(f))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      continue;
    }

    for (const vpFile of vpFiles) {
      const vpPath = path.join(dir, vpFile);
      const archive = getVpIndex(vpPath);
      if (!archive) {
        continue;
      }
      const entry = findVpEntry(archive, normalizedRelative);
      if (entry) {
        return { kind: "vp", containerPath: vpPath, entryPath: entry.path };
      }
    }
  }

  return null;
}

/**
 * FSO looks for POF models under `data/models/`. Table `$Model File:` values are
 * conventionally a bare filename, so this tries that convention first and falls back
 * to treating the given value as an already-relative path (for tables that, unusually,
 * specify one).
 */
export function resolveModelFile(searchDirs: string[], modelFileName: string): ResolvedFile | null {
  return (
    resolveFile(searchDirs, `data/models/${modelFileName}`) ?? resolveFile(searchDirs, modelFileName)
  );
}

/**
 * Lists every file directly under `<dir>/data/tables/` (loose, plus inside every .vp
 * archive in `dir`) whose filename matches `pattern` - used to collect all `.tbm`
 * layers for a base table across one directory, e.g. every `-shp.tbm`. Unlike
 * resolveFile(), this deliberately does NOT stop at the first match: modular tables
 * from every mod in the chain apply cumulatively (see fso-mod-load-order), so the
 * merge step needs all of them, not just the highest-priority one.
 */
export function listMatchingFiles(dir: string, pattern: RegExp): ResolvedFile[] {
  const results: ResolvedFile[] = [];

  const tablesDir = path.join(dir, "data", "tables");
  try {
    for (const f of fs.readdirSync(tablesDir)) {
      if (pattern.test(f)) {
        results.push({ kind: "loose", containerPath: path.join(tablesDir, f) });
      }
    }
  } catch {
    // No loose data/tables directory here - fine, this dir's tables (if any) live in a VP.
  }

  let vpFiles: string[] = [];
  try {
    vpFiles = fs
      .readdirSync(dir)
      .filter((f) => isVpArchiveFilename(f))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    vpFiles = [];
  }

  for (const vpFile of vpFiles) {
    const vpPath = path.join(dir, vpFile);
    const archive = getVpIndex(vpPath);
    if (!archive) {
      continue;
    }
    for (const entry of archive.entries) {
      if (/^data\/tables\//i.test(entry.path) && pattern.test(path.basename(entry.path))) {
        results.push({ kind: "vp", containerPath: vpPath, entryPath: entry.path });
      }
    }
  }

  return results;
}

/** The bare filename of a resolved file, for display and for reverse-alphabetical .tbm ordering within a directory. */
export function basenameOfResolved(resolved: ResolvedFile): string {
  return path.basename(resolved.kind === "loose" ? resolved.containerPath : (resolved.entryPath as string));
}

/** A human-readable provenance label for a resolved file, e.g. for hover/diagnostic messages. */
export function describeResolvedSource(resolved: ResolvedFile): string {
  return resolved.kind === "loose" ? resolved.containerPath : `${resolved.containerPath} :: ${resolved.entryPath}`;
}

export function readResolvedFile(resolved: ResolvedFile): Buffer {
  if (resolved.kind === "loose") {
    return fs.readFileSync(resolved.containerPath);
  }
  const archive = getVpIndex(resolved.containerPath);
  if (!archive) {
    throw new Error(`Failed to re-read VP index for ${resolved.containerPath}`);
  }
  const entry = archive.entries.find((e) => e.path === resolved.entryPath);
  if (!entry) {
    throw new Error(`Entry ${resolved.entryPath} no longer found in ${resolved.containerPath}`);
  }
  return readVpEntry(resolved.containerPath, entry);
}
