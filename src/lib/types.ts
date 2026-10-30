export type Ecosystem = "npm" | "pypi";

export interface Vuln {
  id: string;
  summary: string;
  severity?: string;
  aliases: string[];
  published?: string;
  affectsLatest: boolean;
  url: string;
}

export interface RepoFacts {
  fullName: string;
  url: string;
  stars?: number;
  forks?: number;
  openIssues?: number;
  archived?: boolean;
  pushedAt?: string;
  license?: string;
}

export interface Scorecard {
  score: number;
  date?: string;
  checks: { name: string; score: number }[];
}

export interface PackageFacts {
  ecosystem: Ecosystem;
  name: string;
  exists: boolean;
  registryUrl: string;
  description?: string;
  latestVersion?: string;
  license?: string;
  homepage?: string;
  repoUrl?: string;
  createdAt?: string;
  lastPublishedAt?: string;
  versionCount?: number;
  maintainers: string[];
  latestPublisher?: string;
  /** npm: latest version has a signed build provenance attestation. */
  provenance?: boolean;
  /** npm: latest version was published from CI via trusted publishing. */
  trustedPublisher?: boolean;
  weeklyDownloads?: number;
  deprecated?: string;
  installScripts?: Record<string, string>;
  dependencyCount?: number;
  vulns: Vuln[];
  repo?: RepoFacts;
  scorecard?: Scorecard;
  typosquatOf: { name: string; distance: number }[];
  errors: string[];
}

/** A deterministic signal derived from facts (no LLM involved). */
export interface Signal {
  level: "info" | "warn" | "danger" | "good";
  dimension: Dimension;
  text: string;
}

export type Dimension =
  | "security"
  | "maintenance"
  | "supplyChain"
  | "popularity"
  | "license";

export interface SearchHit {
  id: string;
  query: string;
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
}

export interface Evidence {
  sourceId: string;
  url: string;
  title: string;
  relevant: boolean;
  dimension: Dimension;
  severity: "none" | "low" | "medium" | "high" | "critical";
  finding: string;
  date?: string;
}

export interface Verdict {
  verdict: "adopt" | "caution" | "avoid";
  confidence: "low" | "medium" | "high";
  headline: string;
  summary: string;
  scores: Record<Dimension, number>;
  risks: { title: string; detail: string; severity: "low" | "medium" | "high" | "critical"; citations: string[] }[];
  strengths: string[];
  alternatives: { name: string; why: string }[];
  recommendation: string;
}

export interface LlmCall {
  id: string;
  stage: "plan" | "triage" | "verdict" | "screen";
  tier: "nano" | "super" | "ultra";
  model: string;
  ms: number;
  promptTokens?: number;
  completionTokens?: number;
  ok: boolean;
  error?: string;
}

export interface ScanRow {
  name: string;
  spec: string;
  dev: boolean;
  exists: boolean;
  latestVersion?: string;
  weeklyDownloads?: number;
  lastPublishedAt?: string;
  license?: string;
  signals: Signal[];
  /** Rule-based risk before the model looks at it. */
  ruleRisk: "low" | "medium" | "high";
  /** Nemotron Nano's screening opinion. */
  risk?: "low" | "medium" | "high";
  reason?: string;
}

/** Events streamed from /api/scan as NDJSON. */
export type ScanEvent =
  | { type: "manifest"; ecosystem: Ecosystem; kind: string; total: number; skipped: string[]; truncated: number }
  | { type: "row"; row: ScanRow }
  | { type: "screen"; items: { name: string; risk: "low" | "medium" | "high"; reason: string }[] }
  | { type: "llm"; call: LlmCall }
  | { type: "error"; message: string }
  | { type: "done"; ms: number };

/** Events streamed from /api/vet as NDJSON. */
export type VetEvent =
  /** `t`: ms since the run started, set by the server so cached replays report real timings. */
  | { type: "stage"; stage: "collect" | "plan" | "search" | "triage" | "verdict"; status: "start" | "done"; note?: string; t?: number }
  | { type: "facts"; facts: PackageFacts; signals: Signal[] }
  | { type: "queries"; queries: string[] }
  | { type: "hits"; hits: SearchHit[] }
  | { type: "evidence"; evidence: Evidence[] }
  | { type: "llm"; call: LlmCall }
  | { type: "verdict"; verdict: Verdict }
  | { type: "cached"; ageMs: number }
  | { type: "error"; message: string }
  | { type: "done"; ms: number };
