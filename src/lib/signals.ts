import type { PackageFacts, Signal } from "./types";

const DAY = 86_400_000;
const ageDays = (iso?: string, now = Date.now()) => (iso ? Math.floor((now - Date.parse(iso)) / DAY) : undefined);
const fmt = (n: number) => Intl.NumberFormat("en", { notation: "compact" }).format(n);

const PERMISSIVE = /^(MIT|ISC|BSD-[23]-Clause|Apache-2\.0|0BSD|Unlicense|CC0-1\.0|Python-2\.0|PSF-2\.0|BlueOak-1\.0\.0|Zlib)$/i;
const COPYLEFT = /GPL|AGPL|LGPL|MPL|EUPL|SSPL|CDDL/i;

/** Rule-based signals computed from registry facts. These are shown even if the LLM fails. */
export function deriveSignals(f: PackageFacts, now = Date.now()): Signal[] {
  const s: Signal[] = [];
  if (!f.exists) {
    const near = f.typosquatOf[0] ? ` Did you mean "${f.typosquatOf[0].name}"?` : "";
    s.push({ level: "danger", dimension: "supplyChain", text: `No ${f.ecosystem} package named "${f.name}" exists. If an AI assistant suggested it, this may be a hallucinated name that attackers can register ("slopsquatting").${near}` });
    return s;
  }
  if (f.ecosystem === "npm" && f.latestVersion?.endsWith("-security"))
    s.push({ level: "danger", dimension: "security", text: "npm replaced this package with a security placeholder, which means the original code was removed as malicious." });

  // Security
  const open = f.vulns.filter((v) => v.affectsLatest);
  if (open.length) s.push({ level: "danger", dimension: "security", text: `${open.length} known vulnerabilit${open.length === 1 ? "y affects" : "ies affect"} the latest version (${f.latestVersion}).` });
  else if (f.vulns.length) s.push({ level: "info", dimension: "security", text: `${f.vulns.length} historical advisor${f.vulns.length === 1 ? "y" : "ies"}, none affecting ${f.latestVersion}.` });
  else s.push({ level: "good", dimension: "security", text: "No advisories in OSV.dev." });
  const malicious = f.vulns.filter((v) => v.id.startsWith("MAL-"));
  if (malicious.length) s.push({ level: "danger", dimension: "security", text: `Flagged as malicious in OSV (${malicious.map((m) => m.id).join(", ")}).` });

  // Supply chain
  // Popular packages are the imitated, not the imitators.
  const established = (f.weeklyDownloads ?? 0) >= 50_000;
  if (f.typosquatOf.length && !established) {
    const t = f.typosquatOf[0];
    s.push({ level: "warn", dimension: "supplyChain", text: `Name is ${t.distance === 0 ? "a separator variant" : `${t.distance} edit${t.distance > 1 ? "s" : ""}`} away from the popular package "${t.name}". Check for typosquatting.` });
  }
  if (f.installScripts) s.push({ level: "warn", dimension: "supplyChain", text: `Runs code at install time: ${Object.keys(f.installScripts).join(", ")}.` });
  const created = ageDays(f.createdAt, now);
  if (created !== undefined && created < 90) s.push({ level: "warn", dimension: "supplyChain", text: `First published ${created} days ago.` });
  if (f.maintainers.length === 1) s.push({ level: "info", dimension: "supplyChain", text: `Single maintainer (${f.maintainers[0]}).` });
  if (f.provenance) s.push({ level: "good", dimension: "supplyChain", text: "Latest version has signed build provenance (built from source in CI)." });
  else if (f.trustedPublisher) s.push({ level: "good", dimension: "supplyChain", text: "Latest version was published from CI via trusted publishing." });
  else if (f.latestPublisher && f.maintainers.length && !f.maintainers.includes(f.latestPublisher))
    s.push({ level: "warn", dimension: "supplyChain", text: `Latest version was published by "${f.latestPublisher}", who is not a listed maintainer.` });
  if (f.ecosystem === "npm" && !f.repoUrl) s.push({ level: "warn", dimension: "supplyChain", text: "No source repository linked." });
  if (f.scorecard) s.push({ level: f.scorecard.score >= 7 ? "good" : f.scorecard.score >= 4 ? "info" : "warn", dimension: "supplyChain", text: `OpenSSF Scorecard ${f.scorecard.score.toFixed(1)}/10.` });

  // Maintenance
  if (f.deprecated) s.push({ level: "danger", dimension: "maintenance", text: `Deprecated: ${f.deprecated}` });
  if (f.repo?.archived) s.push({ level: "danger", dimension: "maintenance", text: "Source repository is archived." });
  const last = ageDays(f.lastPublishedAt, now);
  if (last !== undefined) {
    if (last > 730) s.push({ level: "warn", dimension: "maintenance", text: `No release in ${Math.floor(last / 365)} years.` });
    else if (last < 180) s.push({ level: "good", dimension: "maintenance", text: `Last release ${last} days ago.` });
  }
  const pushed = ageDays(f.repo?.pushedAt, now);
  if (pushed !== undefined && pushed > 365 && !f.repo?.archived) s.push({ level: "warn", dimension: "maintenance", text: `No commits in ${Math.floor(pushed / 30)} months.` });

  // Popularity
  if (f.weeklyDownloads !== undefined) {
    const lvl = f.weeklyDownloads >= 100_000 ? "good" : f.weeklyDownloads < 1_000 ? "warn" : "info";
    s.push({ level: lvl, dimension: "popularity", text: `${fmt(f.weeklyDownloads)} downloads last week.` });
  }
  if (f.repo?.stars !== undefined) s.push({ level: "info", dimension: "popularity", text: `${fmt(f.repo.stars)} GitHub stars.` });

  // License
  if (!f.license) s.push({ level: "warn", dimension: "license", text: "No license declared." });
  else if (COPYLEFT.test(f.license)) s.push({ level: "warn", dimension: "license", text: `Copyleft license (${f.license}). Check obligations.` });
  else if (PERMISSIVE.test(f.license)) s.push({ level: "good", dimension: "license", text: `Permissive license (${f.license}).` });
  else s.push({ level: "info", dimension: "license", text: `License: ${f.license}.` });

  return s;
}
