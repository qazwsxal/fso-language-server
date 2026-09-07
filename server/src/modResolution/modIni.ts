export interface ModIni {
  primarylist: string[];
  secondarylist: string[];
}

/**
 * Parses the `[multimod]` section of a mod.ini file (see fso-mod-load-order project
 * memory). Only the load-order-relevant fields are extracted; everything else in
 * mod.ini (`[launcher]`, `[mod]` metadata) is irrelevant to file/table resolution.
 * Tolerates the legacy `secondrylist` misspelling some old launchers wrote.
 */
export function parseModIni(content: string): ModIni {
  const lines = content.split(/\r\n|\r|\n/);
  let inMultimod = false;
  let primarylist: string[] = [];
  let secondarylist: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      inMultimod = line.toLowerCase() === "[multimod]";
      continue;
    }
    if (!inMultimod || line.length === 0) {
      continue;
    }

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) {
      continue;
    }
    const key = line.slice(0, eqIdx).trim().toLowerCase();
    const value = line.slice(eqIdx + 1).trim();
    const list = value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (key === "primarylist") {
      primarylist = list;
    } else if (key === "secondarylist" || key === "secondrylist") {
      secondarylist = list;
    }
  }

  return { primarylist, secondarylist };
}
