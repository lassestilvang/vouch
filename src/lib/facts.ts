import { POPULAR } from "./popular";
import type { Ecosystem, PackageFacts, RepoFacts, Scorecard, Vuln } from "./types";

const UA = "vouch-due-diligence/0.1 (+https://github.com/lassestilvang/vouch)";

async function getJson<T = unknown>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<{ status: number; data?: T }> {
  const res = await fetch(url, {
    ...init,
    headers: { "user-agent": UA, accept: "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return { status: res.status };
  return { status: res.status, data: (await res.json()) as T };
}

/** npm and PyPI name rules, so user input never becomes an arbitrary URL path. */
export function normalizeName(ecosystem: Ecosystem, raw: string): string | null {
  const name = raw.trim();
  if (ecosystem === "npm") {
    const n = name.toLowerCase();
    return /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]{0,213}$/.test(n) ? n : null;
  }
  // PEP 503 normalisation
  if (!/^[A-Za-z0-9]([A-Za-z0-9._-]{0,200}[A-Za-z0-9])?$/.test(name)) return null;
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function typosquatCandidates(ecosystem: Ecosystem, name: string) {
  // Compare full names (scope included) so "@babel/core" is not read as a "cors" lookalike.
  const bare = (s: string) => s.replace(/[-_.]/g, "");
  const target = bare(name);
  if (target.length < 4) return [];
  return POPULAR[ecosystem]
    .filter((p) => p !== name)
    .map((p) => {
      const pb = bare(p);
      // Same letters with separators shuffled ("python-dateutil" vs "python_dateutil")
      // count as distance 0, which is the most suspicious case.
      return { name: p, distance: pb === target ? 0 : levenshtein(target, pb) };
    })
    .filter((c) => c.distance <= (target.length >= 8 ? 2 : 1))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3);
}

function githubRepoFrom(url?: string): { owner: string; repo: string } | null {
  if (!url) return null;
  const m = url.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#?].*)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function repoFacts(repoUrl?: string, skipGithub = false): Promise<{ repo?: RepoFacts; scorecard?: Scorecard }> {
  const gh = githubRepoFrom(repoUrl);
  if (!gh) return {};
  const headers: Record<string, string> = { accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const [r, s] = await Promise.allSettled([
    skipGithub
      ? Promise.resolve({ status: 0, data: undefined })
      : getJson<Record<string, unknown>>(`https://api.github.com/repos/${gh.owner}/${gh.repo}`, { headers }),
    getJson<{ score: number; date: string; checks: { name: string; score: number }[] }>(
      `https://api.securityscorecards.dev/projects/github.com/${gh.owner}/${gh.repo}`,
    ),
  ]);
  const out: { repo?: RepoFacts; scorecard?: Scorecard } = {};
  const base: RepoFacts = { fullName: `${gh.owner}/${gh.repo}`, url: `https://github.com/${gh.owner}/${gh.repo}` };
  if (r.status === "fulfilled" && r.value.data) {
    const d = r.value.data as {
      full_name: string; html_url: string; stargazers_count: number; forks_count: number;
      open_issues_count: number; archived: boolean; pushed_at: string; license?: { spdx_id?: string };
    };
    out.repo = {
      fullName: d.full_name, url: d.html_url, stars: d.stargazers_count, forks: d.forks_count,
      openIssues: d.open_issues_count, archived: d.archived, pushedAt: d.pushed_at,
      license: d.license?.spdx_id,
    };
  } else {
    out.repo = base;
  }
  if (s.status === "fulfilled" && s.value.data) {
    out.scorecard = {
      score: s.value.data.score,
      date: s.value.data.date,
      checks: (s.value.data.checks ?? []).map((c) => ({ name: c.name, score: c.score })),
    };
  }
  return out;
}

interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  published?: string;
  database_specific?: { severity?: string };
  severity?: { type: string; score: string }[];
}

async function osv(ecosystem: Ecosystem, name: string, version?: string): Promise<Vuln[]> {
  const eco = ecosystem === "npm" ? "npm" : "PyPI";
  const query = (v?: string) =>
    getJson<{ vulns?: OsvVuln[] }>("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ package: { name, ecosystem: eco }, ...(v ? { version: v } : {}) }),
    });
  const [all, latest] = await Promise.all([query(), version ? query(version) : Promise.resolve({ status: 200, data: { vulns: [] } })]);
  const latestIds = new Set((latest.data?.vulns ?? []).map((v) => v.id));
  return (all.data?.vulns ?? []).map((v) => ({
    id: v.id,
    summary: v.summary ?? v.details?.slice(0, 200) ?? "",
    severity: v.database_specific?.severity ?? v.severity?.[0]?.type,
    aliases: v.aliases ?? [],
    published: v.published,
    affectsLatest: latestIds.has(v.id),
    url: `https://osv.dev/vulnerability/${v.id}`,
  }));
}

async function npmFacts(name: string, f: PackageFacts) {
  const enc = name.replace("/", "%2f");
  const [latest, deps, dl] = await Promise.allSettled([
    getJson<Record<string, unknown>>(`https://registry.npmjs.org/${enc}/latest`),
    getJson<{ versions: { versionKey: { version: string }; publishedAt?: string; isDeprecated?: boolean }[] }>(
      `https://api.deps.dev/v3/systems/npm/packages/${encodeURIComponent(name)}`,
    ),
    getJson<{ downloads: number }>(`https://api.npmjs.org/downloads/point/last-week/${name}`),
  ]);
  if (latest.status !== "fulfilled" || !latest.value.data) {
    if (latest.status === "fulfilled" && latest.value.status === 404) return false;
    f.errors.push("npm registry lookup failed");
    return true;
  }
  const m = latest.value.data as {
    version: string; description?: string; license?: string | { type: string }; homepage?: string;
    repository?: string | { url?: string }; scripts?: Record<string, string>; deprecated?: string;
    dependencies?: Record<string, string>; maintainers?: { name: string }[]; _npmUser?: { name: string; trustedPublisher?: unknown };
    dist?: { attestations?: { provenance?: unknown } };
  };
  f.provenance = !!m.dist?.attestations?.provenance;
  f.trustedPublisher = !!m._npmUser?.trustedPublisher || /^github actions$/i.test(m._npmUser?.name ?? "");
  f.latestVersion = m.version;
  f.description = m.description;
  f.license = typeof m.license === "string" ? m.license : m.license?.type;
  f.homepage = m.homepage;
  f.repoUrl = typeof m.repository === "string" ? m.repository : m.repository?.url;
  if (f.repoUrl && /^[\w.-]+\/[\w.-]+$/.test(f.repoUrl)) f.repoUrl = `https://github.com/${f.repoUrl}`;
  f.deprecated = m.deprecated;
  f.dependencyCount = Object.keys(m.dependencies ?? {}).length;
  f.maintainers = (m.maintainers ?? []).map((x) => x.name);
  f.latestPublisher = m._npmUser?.name;
  const risky = ["preinstall", "install", "postinstall", "preuninstall", "postuninstall"];
  const scripts = Object.fromEntries(Object.entries(m.scripts ?? {}).filter(([k]) => risky.includes(k)));
  if (Object.keys(scripts).length) f.installScripts = scripts;
  if (deps.status === "fulfilled" && deps.value.data) {
    const vs = deps.value.data.versions.filter((v) => v.publishedAt).sort((a, b) => a.publishedAt!.localeCompare(b.publishedAt!));
    f.versionCount = deps.value.data.versions.length;
    f.createdAt = vs[0]?.publishedAt;
    f.lastPublishedAt = vs.at(-1)?.publishedAt;
  }
  if (dl.status === "fulfilled" && dl.value.data) f.weeklyDownloads = dl.value.data.downloads;
  return true;
}

async function pypiFacts(name: string, f: PackageFacts) {
  const [meta, stats] = await Promise.allSettled([
    getJson<{
      info: {
        version: string; summary?: string; license?: string; license_expression?: string; home_page?: string;
        project_urls?: Record<string, string> | null; author?: string; maintainer?: string;
        classifiers?: string[]; yanked?: boolean; yanked_reason?: string;
      };
      releases: Record<string, { upload_time_iso_8601: string; packagetype: string; yanked: boolean }[]>;
      urls: { packagetype: string }[];
    }>(`https://pypi.org/pypi/${name}/json`),
    getJson<{ data: { last_week: number } }>(`https://pypistats.org/api/packages/${name}/recent`),
  ]);
  if (meta.status !== "fulfilled" || !meta.value.data) {
    if (meta.status === "fulfilled" && meta.value.status === 404) return false;
    f.errors.push("PyPI lookup failed");
    return true;
  }
  const { info, releases, urls } = meta.value.data;
  f.latestVersion = info.version;
  f.description = info.summary;
  const classifierLicense = info.classifiers?.find((c) => c.startsWith("License ::"))?.split("::").at(-1)?.trim();
  f.license = info.license_expression || (info.license && info.license.length < 60 ? info.license : undefined) || classifierLicense;
  const pu = info.project_urls ?? {};
  f.homepage = info.home_page || pu.Homepage || pu.homepage;
  f.repoUrl = Object.values(pu).find((u) => /github\.com\/[^/]+\/[^/]+/.test(u)) ?? (info.home_page?.includes("github.com") ? info.home_page : undefined);
  f.maintainers = [info.author, info.maintainer].filter((x): x is string => !!x && x.length < 80);
  if (info.yanked) f.deprecated = `latest release yanked: ${info.yanked_reason ?? "no reason given"}`;
  const inactive = info.classifiers?.find((c) => c.includes("Development Status :: 7 - Inactive"));
  if (inactive && !f.deprecated) f.deprecated = "marked Inactive (Development Status :: 7)";
  const times = Object.values(releases).flatMap((files) => files.map((x) => x.upload_time_iso_8601)).sort();
  f.versionCount = Object.keys(releases).length;
  f.createdAt = times[0];
  f.lastPublishedAt = times.at(-1);
  if (urls.length && !urls.some((u) => u.packagetype === "bdist_wheel")) {
    f.installScripts = { "setup.py": "latest release ships only an sdist, so installing runs the package's build code" };
  }
  if (stats.status === "fulfilled" && stats.value.data) f.weeklyDownloads = stats.value.data.data.last_week;
  return true;
}

/**
 * Gather facts for one package. `light` skips the GitHub API (60 req/h without a token)
 * so manifest scans of many packages don't exhaust it; Scorecard is still fetched.
 */
export async function collectFacts(ecosystem: Ecosystem, name: string, opts: { light?: boolean } = {}): Promise<PackageFacts> {
  const f: PackageFacts = {
    ecosystem,
    name,
    exists: true,
    registryUrl: ecosystem === "npm" ? `https://www.npmjs.com/package/${name}` : `https://pypi.org/project/${name}/`,
    maintainers: [],
    vulns: [],
    typosquatOf: typosquatCandidates(ecosystem, name),
    errors: [],
  };
  try {
    f.exists = ecosystem === "npm" ? await npmFacts(name, f) : await pypiFacts(name, f);
  } catch (e) {
    f.errors.push(`registry: ${(e as Error).message}`);
  }
  if (!f.exists) return f;
  const skipGithub = !!opts.light && !process.env.GITHUB_TOKEN;
  const [v, r] = await Promise.allSettled([osv(ecosystem, name, f.latestVersion), repoFacts(f.repoUrl, skipGithub)]);
  if (v.status === "fulfilled") f.vulns = v.value;
  else f.errors.push("OSV lookup failed");
  if (r.status === "fulfilled") Object.assign(f, r.value);
  else f.errors.push("repository lookup failed");
  return f;
}
