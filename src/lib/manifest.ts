import { normalizeName } from "./facts";
import type { Ecosystem } from "./types";

export interface ManifestDep {
  name: string;
  spec: string;
  dev: boolean;
}

export interface ParsedManifest {
  ecosystem: Ecosystem;
  kind: "package.json" | "requirements.txt";
  deps: ManifestDep[];
  skipped: string[];
}

export const MAX_DEPS = 40;

/** Parse a pasted package.json or requirements.txt. Throws with a user-facing message. */
export function parseManifest(text: string): ParsedManifest {
  const t = text.trim();
  if (!t) throw new Error("Paste a package.json or requirements.txt.");
  if (t.startsWith("{")) {
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(t);
    } catch {
      throw new Error("That looks like JSON but doesn't parse.");
    }
    const deps: ManifestDep[] = [];
    const skipped: string[] = [];
    for (const [field, dev] of [["dependencies", false], ["devDependencies", true], ["optionalDependencies", false]] as const) {
      const block = j[field];
      if (!block || typeof block !== "object") continue;
      for (const [raw, spec] of Object.entries(block as Record<string, unknown>)) {
        const s = String(spec);
        const name = normalizeName("npm", raw);
        // Local, git and workspace references are not registry packages.
        if (!name || /^(file:|link:|workspace:|git\+|git:|github:|https?:)/.test(s)) skipped.push(raw);
        else if (!deps.some((d) => d.name === name)) deps.push({ name, spec: s, dev });
      }
    }
    return { ecosystem: "npm", kind: "package.json", deps, skipped };
  }
  const deps: ManifestDep[] = [];
  const skipped: string[] = [];
  for (const line of t.split(/\r?\n/)) {
    const l = line.replace(/\s+#.*$/, "").trim();
    if (!l || l.startsWith("#")) continue;
    if (l.startsWith("-") || /^(git\+|https?:|\.|\/)/.test(l)) {
      skipped.push(l.slice(0, 60));
      continue;
    }
    const m = l.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*(.*)$/);
    const name = m && normalizeName("pypi", m[1]);
    if (!m || !name) skipped.push(l.slice(0, 60));
    else if (!deps.some((d) => d.name === name)) deps.push({ name, spec: m[3].split(";")[0].trim(), dev: false });
  }
  if (!deps.length && !skipped.length) throw new Error("No dependencies found.");
  return { ecosystem: "pypi", kind: "requirements.txt", deps, skipped };
}
