import { PofModel } from "./pof/types";
import { parsePof } from "./pof/reader";
import { ResolvedFile, readResolvedFile } from "./modResolution/resolver";

/**
 * Keyed by resolved location, not by table document - the same POF is very often
 * referenced from several ship entries/mods, and re-parsing on every hover/completion
 * request would be wasteful. Cleared wholesale (see clearPofCache()) whenever the
 * client reports a watched .pof/.vp change, rather than tracking per-file dirtiness.
 */
const cache = new Map<string, PofModel>();

export function loadPofCached(resolved: ResolvedFile): PofModel {
  const key = resolved.kind === "loose" ? resolved.containerPath : `${resolved.containerPath}::${resolved.entryPath}`;

  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const buffer = readResolvedFile(resolved);
  const model = parsePof(buffer);
  cache.set(key, model);
  return model;
}

/** Drops all cached parsed POF models, so a changed model/VP is re-read on next access. */
export function clearPofCache(): void {
  cache.clear();
}
