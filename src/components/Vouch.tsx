"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dimension, Ecosystem, Evidence, LlmCall, PackageFacts, SearchHit, Signal, Verdict, VetEvent } from "@/lib/types";

type StageName = "collect" | "plan" | "search" | "triage" | "verdict";
type StageState = { status: "idle" | "running" | "done"; note?: string; startedAt?: number; ms?: number };

const STAGES: { id: StageName; label: string; who: string }[] = [
  { id: "collect", label: "Collect facts", who: "npm / PyPI · OSV.dev · GitHub · OpenSSF" },
  { id: "plan", label: "Plan research", who: "Nemotron Super" },
  { id: "search", label: "Search the web", who: "Tavily" },
  { id: "triage", label: "Triage sources", who: "Nemotron Nano, in parallel" },
  { id: "verdict", label: "Reason to a verdict", who: "Nemotron Ultra" },
];

const DIM_LABEL: Record<Dimension, string> = {
  security: "Security",
  maintenance: "Maintenance",
  supplyChain: "Supply chain",
  popularity: "Adoption",
  license: "License",
};

const EXAMPLES: { e: Ecosystem; n: string; hint: string }[] = [
  { e: "npm", n: "event-stream", hint: "hijacked in 2018" },
  { e: "npm", n: "lodahs", hint: "typosquat" },
  { e: "pypi", n: "reqeusts", hint: "doesn't exist" },
  { e: "npm", n: "colors", hint: "sabotaged by its author" },
  { e: "pypi", n: "requests", hint: "the real one" },
  { e: "npm", n: "zod", hint: "healthy" },
];

const TIER_STYLE: Record<LlmCall["tier"], string> = {
  nano: "bg-info/15 text-info",
  super: "bg-warn/15 text-warn",
  ultra: "bg-accent/15 text-accent",
};

const LEVEL_DOT: Record<Signal["level"], string> = {
  good: "bg-good",
  info: "bg-info",
  warn: "bg-warn",
  danger: "bg-danger",
};

const SEV_STYLE: Record<string, string> = {
  critical: "bg-danger/20 text-danger",
  high: "bg-danger/15 text-danger",
  medium: "bg-warn/15 text-warn",
  low: "bg-info/15 text-info",
  none: "bg-panel-2 text-muted",
};

const VERDICT_STYLE: Record<Verdict["verdict"], { label: string; cls: string }> = {
  adopt: { label: "Adopt", cls: "bg-good/15 text-good border-good/40" },
  caution: { label: "Use with caution", cls: "bg-warn/15 text-warn border-warn/40" },
  avoid: { label: "Avoid", cls: "bg-danger/15 text-danger border-danger/40" },
};

const fmt = (n?: number) => (n === undefined ? "–" : Intl.NumberFormat("en", { notation: "compact" }).format(n));
const date = (s?: string) => (s ? s.slice(0, 10) : "–");
const shortModel = (m: string) => m.replace(/^nvidia\//, "");

function initialStages(): Record<StageName, StageState> {
  return Object.fromEntries(STAGES.map((s) => [s.id, { status: "idle" }])) as Record<StageName, StageState>;
}

export default function Vouch() {
  const [ecosystem, setEcosystem] = useState<Ecosystem>("npm");
  const [name, setName] = useState("");
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState(initialStages);
  const [facts, setFacts] = useState<PackageFacts | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [queries, setQueries] = useState<string[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [calls, setCalls] = useState<LlmCall[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const apply = useCallback((e: VetEvent) => {
    switch (e.type) {
      case "stage":
        setStages((s) => {
          const prev = s[e.stage];
          return {
            ...s,
            [e.stage]:
              e.status === "start"
                ? { status: "running", startedAt: Date.now() }
                : { status: "done", note: e.note, ms: prev.startedAt ? Date.now() - prev.startedAt : undefined },
          };
        });
        break;
      case "facts":
        setFacts(e.facts);
        setSignals(e.signals);
        break;
      case "queries":
        setQueries(e.queries);
        break;
      case "hits":
        setHits(e.hits);
        break;
      case "evidence":
        setEvidence(e.evidence);
        break;
      case "llm":
        setCalls((c) => [...c, e.call]);
        break;
      case "verdict":
        setVerdict(e.verdict);
        break;
      case "error":
        setError(e.message);
        break;
      case "done":
        setTotalMs(e.ms);
        break;
    }
  }, []);

  const run = useCallback(
    async (eco: Ecosystem, pkg: string, fresh = false) => {
      const n = pkg.trim();
      if (!n) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setEcosystem(eco);
      setName(n);
      setRunning(true);
      setStages(initialStages());
      setFacts(null);
      setSignals([]);
      setQueries([]);
      setHits([]);
      setEvidence([]);
      setCalls([]);
      setVerdict(null);
      setError(null);
      setTotalMs(null);
      const url = new URL(window.location.href);
      url.searchParams.set("e", eco);
      url.searchParams.set("p", n);
      window.history.replaceState(null, "", url);
      try {
        const res = await fetch("/api/vet", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ecosystem: eco, name: n, fresh }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `request failed (${res.status})`);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (line) apply(JSON.parse(line) as VetEvent);
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError((err as Error).message);
      } finally {
        if (abortRef.current === ac) setRunning(false);
      }
    },
    [apply],
  );

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const pkg = p.get("p");
    const eco = p.get("e") === "pypi" ? "pypi" : "npm";
    // Deep links (?e=npm&p=name) start a check on load; scheduled so the state update isn't synchronous in the effect.
    if (pkg) queueMicrotask(() => run(eco, pkg));
  }, [run]);

  const started = running || facts !== null;
  const hitById = new Map(hits.map((h) => [h.id, h]));
  const vulnById = new Map((facts?.vulns ?? []).map((v) => [v.id, v]));

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Vouch<span className="text-accent">.</span>
          </h1>
          <p className="mt-1 text-muted">Should you trust this package? An agent checks before you install it.</p>
        </div>
        <p className="text-xs text-muted">
          NVIDIA Nemotron on <span className="text-text">Nebius Token Factory</span> · search by <span className="text-text">Tavily</span>
        </p>
      </header>

      <form
        className="mt-6 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          run(ecosystem, name);
        }}
      >
        <div className="flex rounded-lg border border-line bg-panel p-1" role="radiogroup" aria-label="Ecosystem">
          {(["npm", "pypi"] as const).map((eco) => (
            <button
              key={eco}
              type="button"
              role="radio"
              aria-checked={ecosystem === eco}
              onClick={() => setEcosystem(eco)}
              className={`rounded-md px-3 py-2 text-sm font-medium ${ecosystem === eco ? "bg-panel-2 text-text" : "text-muted hover:text-text"}`}
            >
              {eco === "npm" ? "npm" : "PyPI"}
            </button>
          ))}
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={ecosystem === "npm" ? "package name, e.g. left-pad" : "package name, e.g. requests"}
          aria-label="Package name"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="flex-1 rounded-lg border border-line bg-panel px-4 py-3 font-mono text-sm outline-none placeholder:text-muted focus:border-accent"
        />
        <button
          type="submit"
          disabled={running || !name.trim()}
          className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-black disabled:opacity-50"
        >
          {running ? "Checking…" : "Vet package"}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="py-1 text-muted">Try:</span>
        {EXAMPLES.map((x) => (
          <button
            key={`${x.e}:${x.n}`}
            onClick={() => run(x.e, x.n)}
            disabled={running}
            className="rounded-full border border-line bg-panel px-3 py-1 hover:border-accent disabled:opacity-50"
          >
            <span className="font-mono">{x.n}</span> <span className="text-muted">· {x.hint}</span>
          </button>
        ))}
      </div>

      {error && <div className="mt-6 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

      {!started && <Intro />}

      {started && (
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="flex min-w-0 flex-col gap-6">
            <VerdictCard
              verdict={verdict}
              facts={facts}
              running={running}
              hitById={hitById}
              vulnById={vulnById}
              onAlternative={(n) => run(ecosystem, n)}
            />
            {facts && <FactsCard facts={facts} signals={signals} />}
            {hits.length > 0 && <SourcesCard hits={hits} evidence={evidence} />}
          </div>
          <aside className="flex flex-col gap-6">
            <TraceCard stages={stages} queries={queries} calls={calls} totalMs={totalMs} />
            {totalMs !== null && (
              <button onClick={() => run(ecosystem, name, true)} className="text-left text-xs text-muted underline hover:text-text">
                Re-run without cache
              </button>
            )}
          </aside>
        </div>
      )}

      <footer className="mt-16 border-t border-line pt-6 text-xs text-muted">
        Vouch gives an automated opinion from public data. It can be wrong, so read the cited sources before making a security decision.
        Open source under the MIT license.
      </footer>
    </main>
  );
}

function Intro() {
  const items = [
    ["Hard facts first", "Registry metadata, OSV.dev advisories, GitHub activity, OpenSSF Scorecard, install scripts, typosquat distance and npm provenance. No LLM involved, so these can't be hallucinated."],
    ["Then the web", "Nemotron Super plans targeted Tavily searches for incidents, takeovers and abandonment that databases miss."],
    ["Right-sized models", "Nemotron Nano triages every source in parallel. Nemotron Ultra reasons over everything once and writes a cited verdict."],
  ];
  return (
    <section className="mt-12 grid gap-4 sm:grid-cols-3">
      {items.map(([t, d]) => (
        <div key={t} className="rounded-xl border border-line bg-panel p-5">
          <h2 className="font-medium">{t}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{d}</p>
        </div>
      ))}
    </section>
  );
}

function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Cite({ id, hitById, vulnById }: { id: string; hitById: Map<string, SearchHit>; vulnById: Map<string, { url: string }> }) {
  const clean = id.replace(/[[\]]/g, "");
  const href = hitById.get(clean)?.url ?? vulnById.get(clean)?.url ?? (/^(GHSA|CVE|MAL|PYSEC)-/.test(clean) ? `https://osv.dev/vulnerability/${clean}` : undefined);
  if (!href) return <span className="font-mono text-[11px] text-muted">[{clean}]</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-info hover:underline" title={hitById.get(clean)?.title}>
      [{clean}]
    </a>
  );
}

function VerdictCard({
  verdict,
  facts,
  running,
  hitById,
  vulnById,
  onAlternative,
}: {
  verdict: Verdict | null;
  facts: PackageFacts | null;
  running: boolean;
  hitById: Map<string, SearchHit>;
  vulnById: Map<string, { url: string }>;
  onAlternative: (name: string) => void;
}) {
  const title = facts ? (
    <span className="font-mono">
      {facts.name}
      {facts.latestVersion && <span className="text-muted">@{facts.latestVersion}</span>}
    </span>
  ) : (
    "Verdict"
  );
  if (!verdict) {
    return (
      <section className="rounded-xl border border-line bg-panel p-6">
        <div className="text-lg">{title}</div>
        <div className="mt-4 flex items-center gap-3 text-sm text-muted">
          {running && <span className="pulse-dot h-2 w-2 rounded-full bg-accent" />}
          {running ? "Investigating… the verdict appears when Nemotron Ultra is done." : "No verdict."}
        </div>
      </section>
    );
  }
  const vs = VERDICT_STYLE[verdict.verdict];
  return (
    <section className="rounded-xl border border-line bg-panel p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-lg">{title}</div>
          <h2 className="mt-1 text-xl font-semibold leading-snug">{verdict.headline}</h2>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`rounded-lg border px-4 py-2 text-base font-semibold ${vs.cls}`}>{vs.label}</span>
          <span className="text-xs text-muted">{verdict.confidence} confidence</span>
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-text/90">{verdict.summary}</p>

      <div className="mt-5 grid gap-2 sm:grid-cols-5">
        {(Object.keys(DIM_LABEL) as Dimension[]).map((d) => {
          const v = verdict.scores[d];
          const color = v >= 7 ? "bg-good" : v >= 4 ? "bg-warn" : "bg-danger";
          return (
            <div key={d} className="rounded-lg bg-panel-2 p-3">
              <div className="flex items-baseline justify-between text-xs text-muted">
                <span>{DIM_LABEL[d]}</span>
                <span className="font-mono text-text">{Math.round(v)}/10</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-line">
                <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${v * 10}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      {verdict.risks.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Risks</h3>
          <ul className="mt-2 flex flex-col gap-3">
            {verdict.risks.map((r, i) => (
              <li key={i} className="flex gap-3">
                <span className={`mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium uppercase ${SEV_STYLE[r.severity]}`}>{r.severity}</span>
                <div className="min-w-0 text-sm">
                  <span className="font-medium">{r.title}</span>
                  {r.detail && <span className="text-muted"> {r.detail}</span>}{" "}
                  {r.citations.map((c) => (
                    <Cite key={c} id={c} hitById={hitById} vulnById={vulnById} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {verdict.strengths.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Strengths</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {verdict.strengths.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-good">✓</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-accent/30 bg-accent/5 p-4 text-sm">
        <span className="font-medium text-accent">Recommendation: </span>
        {verdict.recommendation}
      </div>

      {verdict.alternatives.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Alternatives</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {verdict.alternatives.map((a) => (
              <button
                key={a.name}
                onClick={() => onAlternative(a.name)}
                disabled={running}
                className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-left text-sm hover:border-accent"
                title="Vet this alternative"
              >
                <span className="font-mono">{a.name}</span>
                <span className="block text-xs text-muted">{a.why}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function FactsCard({ facts, signals }: { facts: PackageFacts; signals: Signal[] }) {
  const stats: [string, React.ReactNode][] = facts.exists
    ? [
        ["Weekly downloads", fmt(facts.weeklyDownloads)],
        ["Versions", fmt(facts.versionCount)],
        ["First published", date(facts.createdAt)],
        ["Last published", date(facts.lastPublishedAt)],
        ["License", facts.license ?? "none"],
        ["Maintainers", facts.maintainers.length || "–"],
        ["GitHub stars", fmt(facts.repo?.stars)],
        ["OpenSSF Scorecard", facts.scorecard ? `${facts.scorecard.score.toFixed(1)}/10` : "–"],
      ]
    : [];
  return (
    <Card
      title="Facts and rule-based signals"
      right={
        <span className="flex gap-3 text-xs">
          <a className="text-info hover:underline" href={facts.registryUrl} target="_blank" rel="noopener noreferrer">
            registry
          </a>
          {facts.repo && (
            <a className="text-info hover:underline" href={facts.repo.url} target="_blank" rel="noopener noreferrer">
              repo
            </a>
          )}
        </span>
      }
    >
      {stats.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="mt-0.5 font-mono text-sm">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <ul className={`flex flex-col gap-2 text-sm ${stats.length ? "mt-5" : ""}`}>
        {signals.map((s, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${LEVEL_DOT[s.level]}`} aria-label={s.level} />
            <span>
              <span className="text-muted">{DIM_LABEL[s.dimension]}: </span>
              {s.text}
            </span>
          </li>
        ))}
      </ul>
      {facts.vulns.length > 0 && (
        <details className="mt-5 text-sm">
          <summary className="cursor-pointer text-muted hover:text-text">{facts.vulns.length} advisories from OSV.dev</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {facts.vulns.map((v) => (
              <li key={v.id} className="flex gap-2">
                <a href={v.url} target="_blank" rel="noopener noreferrer" className="shrink-0 font-mono text-xs text-info hover:underline">
                  {v.id}
                </a>
                <span className={v.affectsLatest ? "text-danger" : "text-muted"}>
                  {v.affectsLatest ? "affects latest · " : ""}
                  {v.summary}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function SourcesCard({ hits, evidence }: { hits: SearchHit[]; evidence: Evidence[] }) {
  const ev = new Map(evidence.map((e) => [e.sourceId, e]));
  const sorted = [...hits].sort((a, b) => Number(ev.get(b.id)?.relevant ?? 0) - Number(ev.get(a.id)?.relevant ?? 0));
  const relevant = evidence.filter((e) => e.relevant).length;
  return (
    <Card title="Web sources" right={<span className="text-xs text-muted">{evidence.length ? `${relevant} of ${hits.length} relevant` : `${hits.length} found`}</span>}>
      <ul className="flex flex-col divide-y divide-line">
        {sorted.map((h) => {
          const e = ev.get(h.id);
          return (
            <li key={h.id} className={`py-3 first:pt-0 last:pb-0 ${e && !e.relevant ? "opacity-50" : ""}`}>
              <div className="flex items-start gap-2 text-sm">
                <span className="shrink-0 font-mono text-[11px] text-muted">{h.id}</span>
                <div className="min-w-0">
                  <a href={h.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                    {h.title}
                  </a>
                  <div className="truncate text-xs text-muted">{new URL(h.url).hostname}</div>
                  {e && (
                    <p className="mt-1 text-sm">
                      {e.relevant && (
                        <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${SEV_STYLE[e.severity]}`}>{e.severity}</span>
                      )}
                      <span className={e.relevant ? "" : "text-muted"}>{e.relevant ? e.finding : `Not relevant: ${e.finding}`}</span>
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function TraceCard({ stages, queries, calls, totalMs }: { stages: Record<StageName, StageState>; queries: string[]; calls: LlmCall[]; totalMs: number | null }) {
  const byTier = (["nano", "super", "ultra"] as const).map((t) => {
    const cs = calls.filter((c) => c.tier === t);
    return { tier: t, n: cs.length, tokens: cs.reduce((a, c) => a + (c.promptTokens ?? 0) + (c.completionTokens ?? 0), 0) };
  });
  return (
    <Card title="Agent trace" right={totalMs !== null && <span className="font-mono text-xs text-muted">{(totalMs / 1000).toFixed(1)}s</span>}>
      <ol className="flex flex-col gap-3">
        {STAGES.map((s) => {
          const st = stages[s.id];
          return (
            <li key={s.id} className="flex gap-3">
              <span
                className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${st.status === "done" ? "bg-accent" : st.status === "running" ? "pulse-dot bg-accent" : "bg-line"}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className={st.status === "idle" ? "text-muted" : ""}>{s.label}</span>
                  {st.ms !== undefined && <span className="font-mono text-[11px] text-muted">{(st.ms / 1000).toFixed(1)}s</span>}
                </div>
                <div className="text-xs text-muted">
                  {s.who}
                  {st.note ? ` · ${st.note}` : ""}
                </div>
                {s.id === "plan" && queries.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {queries.map((q) => (
                      <li key={q} className="truncate rounded bg-panel-2 px-2 py-1 font-mono text-[11px]" title={q}>
                        {q}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {calls.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted">Model routing</h3>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {byTier.map((t) => (
              <div key={t.tier} className={`rounded-lg px-2 py-2 text-center ${TIER_STYLE[t.tier]}`}>
                <div className="text-xs font-semibold capitalize">{t.tier}</div>
                <div className="font-mono text-[11px]">
                  {t.n} call{t.n === 1 ? "" : "s"}
                </div>
                <div className="font-mono text-[11px] opacity-80">{fmt(t.tokens)} tok</div>
              </div>
            ))}
          </div>
          <ul className="mt-3 flex max-h-64 flex-col gap-1 overflow-auto">
            {calls.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-[11px]">
                <span className={`rounded px-1.5 py-0.5 font-semibold capitalize ${TIER_STYLE[c.tier]}`}>{c.tier}</span>
                <span className="w-12 text-muted">{c.stage}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-muted" title={c.model}>
                  {shortModel(c.model)}
                </span>
                <span className={`font-mono ${c.ok ? "text-muted" : "text-warn"}`} title={c.error}>
                  {c.ok ? `${(c.ms / 1000).toFixed(1)}s` : "retry"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
