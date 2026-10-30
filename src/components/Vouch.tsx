"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import Scan from "./Scan";
import type { Dimension, Ecosystem, Evidence, LlmCall, PackageFacts, SearchHit, Signal, Verdict, VetEvent } from "@/lib/types";

type StageName = "collect" | "plan" | "search" | "triage" | "verdict";
type StageState = { status: "idle" | "running" | "done"; note?: string; startedAt?: number; serverClock?: boolean; ms?: number };
type Tier = LlmCall["tier"] | "data" | "web";

const STAGES: { id: StageName; label: string; who: string; tier: Tier }[] = [
  { id: "collect", label: "Collect facts", who: "No LLM", tier: "data" },
  { id: "plan", label: "Plan research", who: "Nemotron Super", tier: "super" },
  { id: "search", label: "Search the web", who: "Tavily", tier: "web" },
  { id: "triage", label: "Triage sources", who: "Nemotron Nano ×N", tier: "nano" },
  { id: "verdict", label: "Reason", who: "Nemotron Ultra", tier: "ultra" },
];

const DIM_LABEL: Record<Dimension, string> = {
  security: "Security",
  maintenance: "Maintenance",
  supplyChain: "Supply chain",
  popularity: "Adoption",
  license: "License",
};
const DIM_WEIGHT: Record<Dimension, number> = { security: 0.3, supplyChain: 0.25, maintenance: 0.25, popularity: 0.1, license: 0.1 };

const EXAMPLES: { e: Ecosystem; n: string; hint: string; tone: "danger" | "warn" | "good" }[] = [
  { e: "npm", n: "event-stream", hint: "hijacked in 2018", tone: "danger" },
  { e: "pypi", n: "reqeusts", hint: "doesn't exist", tone: "danger" },
  { e: "npm", n: "lodahs", hint: "typosquat", tone: "danger" },
  { e: "npm", n: "colors", hint: "sabotaged", tone: "warn" },
  { e: "pypi", n: "requests", hint: "the real one", tone: "good" },
  { e: "npm", n: "zod", hint: "healthy", tone: "good" },
];

const TIER_STYLE: Record<Tier, string> = {
  nano: "bg-info/15 text-info ring-info/30",
  super: "bg-warn/15 text-warn ring-warn/30",
  ultra: "bg-accent/15 text-accent ring-accent/30",
  data: "bg-white/5 text-text ring-white/15",
  web: "bg-[#a371f7]/15 text-[#c4a5ff] ring-[#a371f7]/30",
};

const LEVEL_STYLE: Record<Signal["level"], { dot: string; icon: string }> = {
  good: { dot: "bg-good/15 text-good", icon: "✓" },
  info: { dot: "bg-info/15 text-info", icon: "i" },
  warn: { dot: "bg-warn/15 text-warn", icon: "!" },
  danger: { dot: "bg-danger/15 text-danger", icon: "✕" },
};

const SEV: Record<string, { chip: string; bar: string }> = {
  critical: { chip: "bg-danger text-black", bar: "bg-danger" },
  high: { chip: "bg-danger/15 text-danger", bar: "bg-danger/70" },
  medium: { chip: "bg-warn/15 text-warn", bar: "bg-warn/70" },
  low: { chip: "bg-info/15 text-info", bar: "bg-info/50" },
  none: { chip: "bg-white/5 text-muted", bar: "bg-line" },
};

const VERDICT_STYLE: Record<Verdict["verdict"], { label: string; text: string; ring: string; glow: string; hex: string }> = {
  adopt: { label: "Adopt", text: "text-good", ring: "ring-good/40 bg-good/10", glow: "verdict-adopt", hex: "#3fb950" },
  caution: { label: "Caution", text: "text-warn", ring: "ring-warn/40 bg-warn/10", glow: "verdict-caution", hex: "#d29922" },
  avoid: { label: "Avoid", text: "text-danger", ring: "ring-danger/40 bg-danger/10", glow: "verdict-avoid", hex: "#f85149" },
};

const fmt = (n?: number) => (n === undefined ? "–" : Intl.NumberFormat("en", { notation: "compact" }).format(n));
const date = (s?: string) => (s ? s.slice(0, 10) : "–");
const shortModel = (m: string) => m.replace(/^nvidia\//, "");
const scoreColor = (v: number) => (v >= 7 ? "#3fb950" : v >= 4 ? "#d29922" : "#f85149");

function initialStages(): Record<StageName, StageState> {
  return Object.fromEntries(STAGES.map((s) => [s.id, { status: "idle" }])) as Record<StageName, StageState>;
}

export default function Vouch() {
  const [mode, setMode] = useState<"single" | "scan">("single");
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
  const [cachedAgeMs, setCachedAgeMs] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const apply = useCallback((e: VetEvent) => {
    switch (e.type) {
      case "stage":
        setStages((s) => {
          const prev = s[e.stage];
          return {
            ...s,
            // Prefer server offsets: they stay true when a cached run is replayed faster.
            [e.stage]:
              e.status === "start"
                ? { status: "running", startedAt: e.t ?? Date.now(), serverClock: e.t !== undefined }
                : {
                    status: "done",
                    note: e.note,
                    ms: prev.startedAt === undefined ? undefined : (prev.serverClock ? (e.t ?? 0) : Date.now()) - prev.startedAt,
                  },
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
      case "cached":
        setCachedAgeMs(e.ageMs);
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
      setMode("single");
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
      setCachedAgeMs(null);
      setStartedAt(Date.now());
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
  const compact = started && mode === "single";

  const reset = () => {
    abortRef.current?.abort();
    setRunning(false);
    setFacts(null);
    setVerdict(null);
    setName("");
    setMode("single");
    window.history.replaceState(null, "", window.location.pathname);
  };

  return (
    <>
      <div className="app-bg" aria-hidden />
      <Header onHome={reset} />
      <main className="mx-auto w-full max-w-7xl px-5 pb-20 sm:px-8">
        <section className={`flex flex-col items-center text-center transition-all duration-500 ${compact ? "pt-6" : "pt-16 sm:pt-24"}`}>
          {!compact && (
            <>
              <div className="rise inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-xs text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                NVIDIA Nemotron 3 · Nebius Token Factory · Tavily
              </div>
              <h1 className="rise mt-7 text-5xl font-semibold leading-[1.02] tracking-[-0.035em] sm:text-7xl" style={{ animationDelay: "60ms" }}>
                Know what you <span className="text-gradient">install</span>.
              </h1>
              <p className="rise mt-6 max-w-2xl text-lg leading-relaxed text-muted sm:text-xl" style={{ animationDelay: "120ms" }}>
                An AI agent that investigates any npm or PyPI package before it touches your machine, and gives you a cited verdict in seconds.
              </p>
            </>
          )}

          <div className={`rise w-full ${compact ? "max-w-5xl" : "mt-10 max-w-3xl"}`} style={{ animationDelay: "180ms" }}>
            <ModeToggle mode={mode} setMode={setMode} />
            {mode === "single" && (
              <SearchBox
                ecosystem={ecosystem}
                setEcosystem={setEcosystem}
                name={name}
                setName={setName}
                running={running}
                size={compact ? "md" : "lg"}
                onSubmit={() => run(ecosystem, name)}
              />
            )}
            {mode === "single" && !compact && (
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((x) => (
                  <button
                    key={`${x.e}:${x.n}`}
                    onClick={() => run(x.e, x.n)}
                    disabled={running}
                    className="group flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-sm transition hover:border-accent/60 hover:bg-accent/5 disabled:opacity-50"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${x.tone === "danger" ? "bg-danger" : x.tone === "warn" ? "bg-warn" : "bg-good"}`} />
                    <span className="font-mono">{x.n}</span>
                    <span className="text-muted group-hover:text-text">{x.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Kept mounted so scan results survive a deep dive and a switch back. */}
        <div hidden={mode !== "scan"} className="mx-auto max-w-6xl">
          <Scan
            onDeepDive={(eco, n) => {
              run(eco, n);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </div>

        {error && <div className="mx-auto mt-6 max-w-3xl rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

        {mode === "single" && !started && <Landing />}

        {mode === "single" && started && (
          <div className="mt-8">
            <Pipeline stages={stages} calls={calls} totalMs={totalMs} running={running} startedAt={startedAt} cachedAgeMs={cachedAgeMs} />
            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="flex min-w-0 flex-col gap-6">
                <VerdictCard
                  verdict={verdict}
                  facts={facts}
                  running={running}
                  evidenceCount={evidence.filter((e) => e.relevant).length}
                  hitById={hitById}
                  vulnById={vulnById}
                  onAlternative={(n) => run(ecosystem, n)}
                />
                {facts && <FactsCard facts={facts} signals={signals} />}
                {hits.length > 0 && <SourcesCard hits={hits} evidence={evidence} />}
              </div>
              <aside data-demo="trace" className="flex flex-col gap-4">
                <TraceCard stages={stages} queries={queries} calls={calls} totalMs={totalMs} />
                {totalMs !== null && (
                  <button onClick={() => run(ecosystem, name, true)} className="self-start text-xs text-muted underline-offset-4 hover:text-text hover:underline">
                    Re-run without cache
                  </button>
                )}
              </aside>
            </div>
          </div>
        )}

        <footer className="mt-24 flex flex-wrap items-center justify-between gap-4 border-t border-white/5 pt-6 text-xs text-muted">
          <span>Vouch gives an automated opinion from public data. Read the cited sources before making a security decision.</span>
          <span className="flex gap-4">
            <Link href="/pitch" className="hover:text-text">
              Pitch deck
            </Link>
            <a href="https://github.com/lassestilvang/vouch" target="_blank" rel="noopener noreferrer" className="hover:text-text">
              GitHub · MIT
            </a>
          </span>
        </footer>
      </main>
    </>
  );
}

/* ---------- chrome ---------- */

function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="#76b900" />
      <path d="M17 21l15 25 15-25" fill="none" stroke="#0b0d10" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Header({ onHome }: { onHome: () => void }) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/5 bg-bg/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <button onClick={onHome} className="flex items-center gap-2.5" aria-label="Vouch home">
          <Logo />
          <span className="text-lg font-semibold tracking-tight">
            Vouch<span className="text-accent">.</span>
          </span>
        </button>
        <nav className="flex items-center gap-1 text-sm text-muted">
          <Link href="/pitch" className="rounded-lg px-3 py-2 hover:bg-white/5 hover:text-text">
            Pitch
          </Link>
          <a
            href="https://github.com/lassestilvang/vouch"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/5 hover:text-text"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}

function ModeToggle({ mode, setMode }: { mode: "single" | "scan"; setMode: (m: "single" | "scan") => void }) {
  return (
    <div className="mb-3 flex justify-center">
      <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1 text-sm" role="tablist">
        {(
          [
            ["single", "One package"],
            ["scan", "Scan a manifest"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`rounded-lg px-4 py-1.5 transition ${mode === m ? "bg-white/10 text-text shadow-sm" : "text-muted hover:text-text"}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SearchBox({
  ecosystem,
  setEcosystem,
  name,
  setName,
  running,
  size,
  onSubmit,
}: {
  ecosystem: Ecosystem;
  setEcosystem: (e: Ecosystem) => void;
  name: string;
  setName: (s: string) => void;
  running: boolean;
  size: "lg" | "md";
  onSubmit: () => void;
}) {
  const lg = size === "lg";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className={`glass flex items-center gap-2 rounded-2xl p-2 transition focus-within:border-accent/50 focus-within:shadow-[0_0_0_4px_rgba(118,185,0,0.12)] ${lg ? "" : ""}`}
    >
      <div className="flex shrink-0 rounded-xl bg-black/30 p-1" role="radiogroup" aria-label="Ecosystem">
        {(["npm", "pypi"] as const).map((eco) => (
          <button
            key={eco}
            type="button"
            role="radio"
            aria-checked={ecosystem === eco}
            onClick={() => setEcosystem(eco)}
            className={`rounded-lg font-medium transition ${lg ? "px-4 py-2.5 text-sm" : "px-3 py-1.5 text-sm"} ${ecosystem === eco ? "bg-white/10 text-text" : "text-muted hover:text-text"}`}
          >
            {eco === "npm" ? "npm" : "PyPI"}
          </button>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-muted">{ecosystem === "npm" ? "npm i" : "pip install"}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={ecosystem === "npm" ? "left-pad" : "requests"}
          aria-label="Package name"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={`w-full bg-transparent font-mono outline-none placeholder:text-white/25 ${lg ? "py-3 text-lg" : "py-2 text-base"} ${ecosystem === "npm" ? "pl-[4.25rem]" : "pl-[7.25rem]"}`}
        />
      </div>
      <button
        type="submit"
        disabled={running || !name.trim()}
        className={`flex shrink-0 items-center gap-2 rounded-xl bg-accent font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 ${lg ? "px-6 py-3 text-base" : "px-5 py-2 text-sm"}`}
      >
        {running ? (
          <>
            <span className="spin h-4 w-4 rounded-full border-2 border-black/30 border-t-black" />
            Checking
          </>
        ) : (
          <>Vet package</>
        )}
      </button>
    </form>
  );
}

/* ---------- landing ---------- */

function Landing() {
  const steps = [
    { t: "Facts", d: "Registry, OSV, GitHub, Scorecard", tier: "data" as Tier, k: "no LLM" },
    { t: "Plan", d: "Targeted searches", tier: "super" as Tier, k: "Nemotron Super" },
    { t: "Search", d: "Incidents & takeovers", tier: "web" as Tier, k: "Tavily" },
    { t: "Triage", d: "Every source, in parallel", tier: "nano" as Tier, k: "Nemotron Nano" },
    { t: "Verdict", d: "Cited and calibrated", tier: "ultra" as Tier, k: "Nemotron Ultra" },
  ];
  const cards = [
    {
      t: "Facts can't be hallucinated",
      d: "Advisories, release history, archived repos, install scripts, provenance and typosquat distance come straight from the source and are shown before any model runs.",
      i: "◆",
    },
    { t: "Reads what databases miss", d: "Maintainer takeovers, sabotage and abandonment live in blog posts and issues. Vouch searches, reads and filters them for you.", i: "◎" },
    {
      t: "Right model for each job",
      d: "Nano triages sources in parallel. Ultra reasons once over distilled evidence. Fast, cheap, and careful where it counts.",
      i: "▲",
    },
  ];
  return (
    <section className="mx-auto mt-24 max-w-6xl">
      <div className="glass rounded-3xl p-6 sm:p-8">
        <div className="text-center text-xs uppercase tracking-[0.2em] text-muted">How an investigation runs</div>
        <ol className="mt-8 grid gap-3 sm:grid-cols-5">
          {steps.map((s, i) => (
            <li key={s.t} className="relative rounded-2xl border border-white/5 bg-black/20 p-4 text-left">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-muted">0{i + 1}</span>
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${TIER_STYLE[s.tier]}`}>{s.k}</span>
              </div>
              <div className="mt-4 text-lg font-semibold">{s.t}</div>
              <div className="mt-1 text-sm text-muted">{s.d}</div>
              {i < 4 && <span className="absolute -right-2.5 top-1/2 z-10 hidden -translate-y-1/2 text-accent sm:block">›</span>}
            </li>
          ))}
        </ol>
      </div>
      <div className="mt-6 grid gap-6 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.t} className="glass rounded-3xl p-7">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">{c.i}</div>
            <h2 className="mt-5 text-lg font-semibold">{c.t}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{c.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------- live pipeline ---------- */

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono tabular-nums text-text">{(Math.max(0, now - since) / 1000).toFixed(1)}s</span>;
}

function Pipeline({
  stages,
  calls,
  totalMs,
  running,
  startedAt,
  cachedAgeMs,
}: {
  stages: Record<StageName, StageState>;
  calls: LlmCall[];
  totalMs: number | null;
  running: boolean;
  startedAt: number | null;
  cachedAgeMs: number | null;
}) {
  const nano = calls.filter((c) => c.tier === "nano").length;
  const ago = cachedAgeMs === null ? "" : cachedAgeMs < 60_000 ? "moments ago" : `${Math.round(cachedAgeMs / 60_000)} min ago`;
  return (
    <div data-demo="pipeline" className="glass rise rounded-2xl px-5 py-4">
      <ol className="grid grid-cols-5 gap-2">
        {STAGES.map((s, i) => {
          const st = stages[s.id];
          const next = STAGES[i + 1] && stages[STAGES[i + 1].id];
          return (
            <li key={s.id} className="relative flex items-center gap-3">
              <span
                className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 transition ${
                  st.status === "done" ? "bg-accent text-black ring-accent" : st.status === "running" ? "bg-accent/10 text-accent ring-accent/60" : "bg-white/5 text-muted ring-white/10"
                }`}
              >
                {st.status === "done" ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : st.status === "running" ? (
                  <span className="spin h-5 w-5 rounded-full border-2 border-accent/25 border-t-accent" />
                ) : (
                  <span className="font-mono text-xs">{i + 1}</span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`truncate text-sm font-medium ${st.status === "idle" ? "text-muted" : ""}`}>{s.label}</div>
                <div className="flex items-center gap-1.5 truncate text-xs text-muted">
                  <span className={`rounded px-1.5 py-px text-[10px] font-medium ring-1 ${TIER_STYLE[s.tier]}`}>
                    {s.id === "triage" && nano ? `Nano ×${nano}` : s.who}
                  </span>
                  {st.ms !== undefined && <span className="font-mono">{(st.ms / 1000).toFixed(1)}s</span>}
                </div>
              </div>
              {i < 4 && (
                <svg className="hidden h-2 w-8 shrink-0 lg:block" viewBox="0 0 32 8" aria-hidden>
                  <line
                    x1="0"
                    y1="4"
                    x2="32"
                    y2="4"
                    stroke={st.status === "done" ? "#76b900" : "rgba(255,255,255,0.12)"}
                    strokeWidth="2"
                    className={st.status === "done" && next?.status === "running" ? "flow" : ""}
                  />
                </svg>
              )}
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3 text-xs text-muted">
        {totalMs !== null ? (
          <span>
            Investigation finished in <span className="font-mono text-text">{(totalMs / 1000).toFixed(1)}s</span> · {calls.length} Nemotron call
            {calls.length === 1 ? "" : "s"} on Nebius Token Factory
          </span>
        ) : running && cachedAgeMs !== null ? (
          <span className="flex items-center gap-2">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />
            Replaying at speed · stage timings are from the original run
          </span>
        ) : running && startedAt !== null ? (
          <span className="flex items-center gap-2">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />
            Investigating · <Elapsed since={startedAt} /> · {calls.length} Nemotron call{calls.length === 1 ? "" : "s"} so far
          </span>
        ) : (
          <span />
        )}
        {cachedAgeMs !== null && <span>Replay of a live run from {ago}</span>}
      </div>
    </div>
  );
}

/* ---------- verdict ---------- */

function Gauge({ value, color, size = 132, stroke = 10, label }: { value: number; color: string; size?: number; stroke?: number; label?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const off = len * (1 - Math.max(0, Math.min(1, value)));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={off}
          className="gauge-arc"
          style={{ ["--gauge-len" as string]: `${len}` } as React.CSSProperties}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{label}</div>
    </div>
  );
}

function Cite({ id, hitById, vulnById }: { id: string; hitById: Map<string, SearchHit>; vulnById: Map<string, { url: string }> }) {
  const clean = id.replace(/[[\]]/g, "");
  const href =
    hitById.get(clean)?.url ?? vulnById.get(clean)?.url ?? (/^(GHSA|CVE|MAL|PYSEC)-/.test(clean) ? `https://osv.dev/vulnerability/${clean}` : undefined);
  const cls = "ml-1 inline-flex rounded-md bg-info/10 px-1.5 py-px font-mono text-[11px] text-info ring-1 ring-info/20";
  if (!href) return <span className={cls}>{clean}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${cls} hover:bg-info/20`} title={hitById.get(clean)?.title}>
      {clean}
    </a>
  );
}

function VerdictCard({
  verdict,
  facts,
  running,
  evidenceCount,
  hitById,
  vulnById,
  onAlternative,
}: {
  verdict: Verdict | null;
  facts: PackageFacts | null;
  running: boolean;
  evidenceCount: number;
  hitById: Map<string, SearchHit>;
  vulnById: Map<string, { url: string }>;
  onAlternative: (name: string) => void;
}) {
  const pkg = facts && (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-lg">
        {facts.name}
        {facts.latestVersion && <span className="text-muted">@{facts.latestVersion}</span>}
      </span>
      <span className="rounded-md bg-white/5 px-2 py-0.5 text-xs text-muted ring-1 ring-white/10">{facts.ecosystem === "npm" ? "npm" : "PyPI"}</span>
      {facts.description && <span className="hidden truncate text-sm text-muted md:inline md:max-w-md">{facts.description}</span>}
    </div>
  );

  if (!verdict) {
    return (
      <section className="glass rise overflow-hidden rounded-3xl p-7">
        {pkg ?? <div className="skeleton h-6 w-56" />}
        <div className="mt-7 flex items-center gap-7">
          <div className="relative h-[132px] w-[132px] shrink-0">
            <div className="spin absolute inset-0 rounded-full border-[10px] border-white/5 border-t-accent" />
            <div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-muted">thinking</div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-accent">{running ? "Nemotron Ultra is weighing the evidence" : "No verdict"}</div>
            <div className="mt-1 text-sm text-muted">
              {facts
                ? `${facts.vulns.length} advisor${facts.vulns.length === 1 ? "y" : "ies"} · ${evidenceCount ? `${evidenceCount} relevant web sources` : "web sources in triage"} · registry and repository signals`
                : "Collecting facts…"}
            </div>
            <div className="mt-5 space-y-2.5">
              <div className="skeleton h-4 w-11/12" />
              <div className="skeleton h-4 w-9/12" />
              <div className="skeleton h-4 w-10/12" />
            </div>
          </div>
        </div>
      </section>
    );
  }

  const vs = VERDICT_STYLE[verdict.verdict];
  const dims = Object.keys(DIM_LABEL) as Dimension[];
  const trust = Math.round(dims.reduce((a, d) => a + verdict.scores[d] * DIM_WEIGHT[d], 0) * 10);

  return (
    <section data-demo="verdict" className={`glass rise overflow-hidden rounded-3xl ${vs.glow}`}>
      <div className="relative p-7">
        <div className="pointer-events-none absolute inset-0 opacity-60" style={{ background: `radial-gradient(40rem 16rem at 0% 0%, ${vs.hex}26, transparent 70%)` }} />
        <div className="relative">
          {pkg}
          <div className="mt-6 flex flex-col gap-7 sm:flex-row sm:items-center">
            <Gauge
              value={trust / 100}
              color={vs.hex}
              label={
                <>
                  <span className="text-4xl font-semibold tracking-tight">{trust}</span>
                  <span className="text-[11px] uppercase tracking-widest text-muted">trust</span>
                </>
              }
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`rounded-xl px-4 py-1.5 text-3xl font-bold tracking-tight ring-1 ${vs.ring} ${vs.text}`}>{vs.label}</span>
                <span className="rounded-lg bg-white/5 px-2.5 py-1 text-xs text-muted ring-1 ring-white/10">{verdict.confidence} confidence</span>
              </div>
              <h2 className="mt-3 text-2xl font-semibold leading-snug tracking-tight">{verdict.headline}</h2>
            </div>
          </div>
          <p className="mt-6 text-[15px] leading-relaxed text-text/85">{verdict.summary}</p>

          <div className="mt-7 grid grid-cols-5 gap-3">
            {dims.map((d) => {
              const v = verdict.scores[d];
              return (
                <div key={d} className="flex flex-col items-center rounded-2xl bg-black/25 px-2 py-4 ring-1 ring-white/5">
                  <Gauge value={v / 10} color={scoreColor(v)} size={64} stroke={6} label={<span className="font-mono text-base font-semibold">{Math.round(v)}</span>} />
                  <span className="mt-2 text-xs text-muted">{DIM_LABEL[d]}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {verdict.risks.length > 0 && (
        <div data-demo="risks" className="border-t border-white/5 p-7">
          <h3 className="text-xs font-medium uppercase tracking-[0.15em] text-muted">Risks</h3>
          <ul className="mt-4 flex flex-col gap-3">
            {verdict.risks.map((r, i) => (
              <li key={i} className="relative overflow-hidden rounded-2xl bg-black/25 py-4 pl-6 pr-5 ring-1 ring-white/5">
                <span className={`absolute inset-y-0 left-0 w-1 ${SEV[r.severity].bar}`} />
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${SEV[r.severity].chip}`}>{r.severity}</span>
                  <span className="font-semibold">{r.title}</span>
                </div>
                {(r.detail || r.citations.length > 0) && (
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">
                    {r.detail}
                    {r.citations.map((c) => (
                      <Cite key={c} id={c} hitById={hitById} vulnById={vulnById} />
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 border-t border-white/5 p-7 md:grid-cols-2">
        <div className="rounded-2xl bg-accent/[0.07] p-5 ring-1 ring-accent/25">
          <div className="text-xs font-medium uppercase tracking-[0.15em] text-accent">Recommendation</div>
          <p className="mt-2 text-[15px] leading-relaxed">{verdict.recommendation}</p>
        </div>
        {verdict.strengths.length > 0 && (
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.15em] text-muted">Strengths</div>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {verdict.strengths.map((s, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-good/15 text-[10px] text-good">✓</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {verdict.alternatives.length > 0 && (
        <div className="border-t border-white/5 p-7">
          <h3 className="text-xs font-medium uppercase tracking-[0.15em] text-muted">Safer alternatives</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {verdict.alternatives.map((a) => (
              <button
                key={a.name}
                onClick={() => onAlternative(a.name)}
                disabled={running}
                className="group rounded-2xl bg-black/25 p-4 text-left ring-1 ring-white/5 transition hover:ring-accent/50"
                title="Vet this alternative"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono">{a.name}</span>
                  <span className="text-xs text-accent opacity-60 transition group-hover:opacity-100">Vet →</span>
                </div>
                <span className="mt-1 block text-sm text-muted">{a.why}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------- detail panels ---------- */

function Panel({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="glass rise rounded-3xl">
      <div className="flex items-center justify-between px-6 pb-2 pt-5">
        <h2 className="text-xs font-medium uppercase tracking-[0.15em] text-muted">{title}</h2>
        {right}
      </div>
      <div className="px-6 pb-6 pt-2">{children}</div>
    </section>
  );
}

function FactsCard({ facts, signals }: { facts: PackageFacts; signals: Signal[] }) {
  const stats: [string, React.ReactNode][] = facts.exists
    ? [
        ["Weekly downloads", fmt(facts.weeklyDownloads)],
        ["Last release", date(facts.lastPublishedAt)],
        // PyPI often lists no maintainers in metadata; show downloads-rank style info instead of a dash.
        facts.maintainers.length ? ["Maintainers", facts.maintainers.length] : ["Latest version", facts.latestVersion ?? "–"],
        ["OpenSSF Scorecard", facts.scorecard ? `${facts.scorecard.score.toFixed(1)}/10` : "–"],
        ["Versions", fmt(facts.versionCount)],
        ["First published", date(facts.createdAt)],
        ["License", facts.license ?? "none"],
        ["GitHub stars", fmt(facts.repo?.stars)],
      ]
    : [];
  const order = { danger: 0, warn: 1, info: 2, good: 3 } as const;
  const sorted = [...signals].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <Panel
      title="Hard facts · no LLM involved"
      right={
        <span className="flex gap-3 text-xs">
          <a className="text-info hover:underline" href={facts.registryUrl} target="_blank" rel="noopener noreferrer">
            registry ↗
          </a>
          {facts.repo && (
            <a className="text-info hover:underline" href={facts.repo.url} target="_blank" rel="noopener noreferrer">
              repo ↗
            </a>
          )}
        </span>
      }
    >
      {stats.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-black/25 px-4 py-3 ring-1 ring-white/5">
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="mt-1 truncate font-mono text-lg">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <ul className={`grid gap-2 sm:grid-cols-2 ${stats.length ? "mt-5" : ""}`}>
        {sorted.map((s, i) => (
          <li key={i} className="flex items-start gap-3 rounded-xl px-1 py-1 text-sm">
            <span className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${LEVEL_STYLE[s.level].dot}`}>
              {LEVEL_STYLE[s.level].icon}
            </span>
            <span className="leading-relaxed">
              <span className="text-muted">{DIM_LABEL[s.dimension]} · </span>
              {s.text}
            </span>
          </li>
        ))}
      </ul>
      {facts.vulns.length > 0 && (
        <details className="mt-5 text-sm">
          <summary className="cursor-pointer text-muted hover:text-text">{facts.vulns.length} advisories from OSV.dev</summary>
          <ul className="mt-3 flex flex-col gap-1.5">
            {facts.vulns.map((v) => (
              <li key={v.id} className="flex gap-3">
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
    </Panel>
  );
}

function SourcesCard({ hits, evidence }: { hits: SearchHit[]; evidence: Evidence[] }) {
  const ev = new Map(evidence.map((e) => [e.sourceId, e]));
  const relevant = hits.filter((h) => ev.get(h.id)?.relevant);
  const rest = hits.filter((h) => !ev.get(h.id)?.relevant);
  const sevRank = { critical: 0, high: 1, medium: 2, low: 3, none: 4 } as const;
  relevant.sort((a, b) => sevRank[ev.get(a.id)!.severity] - sevRank[ev.get(b.id)!.severity]);
  const Row = ({ h }: { h: SearchHit }) => {
    const e = ev.get(h.id);
    const host = new URL(h.url).hostname.replace(/^www\./, "");
    return (
      <li className="flex gap-3 rounded-2xl bg-black/25 p-4 ring-1 ring-white/5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/5 font-mono text-[11px] uppercase text-muted ring-1 ring-white/10">
          {host[0]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <a href={h.url} target="_blank" rel="noopener noreferrer" className="line-clamp-1 font-medium hover:underline">
              {h.title}
            </a>
            <span className="shrink-0 font-mono text-[11px] text-muted">{h.id}</span>
          </div>
          <div className="text-xs text-muted">{host}</div>
          {e && (
            <p className="mt-2 text-sm leading-relaxed">
              {e.relevant && e.severity !== "none" && (
                <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${SEV[e.severity].chip}`}>{e.severity}</span>
              )}
              <span className={e.relevant ? "text-text/85" : "text-muted"}>{e.finding}</span>
            </p>
          )}
        </div>
      </li>
    );
  };
  return (
    <Panel
      title="Web evidence · Tavily + Nemotron Nano"
      right={<span className="text-xs text-muted">{evidence.length ? `${relevant.length} of ${hits.length} relevant` : `${hits.length} found`}</span>}
    >
      <ul className="flex flex-col gap-2.5">
        {(evidence.length ? relevant : hits).map((h) => (
          <Row key={h.id} h={h} />
        ))}
      </ul>
      {evidence.length > 0 && rest.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-muted hover:text-text">{rest.length} sources filtered out as off-topic</summary>
          <ul className="mt-3 flex flex-col gap-2.5 opacity-60">
            {rest.map((h) => (
              <Row key={h.id} h={h} />
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}

function TraceCard({
  stages,
  queries,
  calls,
  totalMs,
}: {
  stages: Record<StageName, StageState>;
  queries: string[];
  calls: LlmCall[];
  totalMs: number | null;
}) {
  const byTier = (["nano", "super", "ultra"] as const).map((t) => {
    const cs = calls.filter((c) => c.tier === t);
    return { tier: t, n: cs.length, tokens: cs.reduce((a, c) => a + (c.promptTokens ?? 0) + (c.completionTokens ?? 0), 0) };
  });
  const maxTok = Math.max(1, ...byTier.map((t) => t.tokens));
  return (
    <Panel title="Agent trace" right={totalMs !== null && <span className="font-mono text-xs text-muted">{(totalMs / 1000).toFixed(1)}s</span>}>
      <div data-demo="routing" className="rounded-2xl bg-black/25 p-4 ring-1 ring-white/5">
        <div className="text-xs text-muted">Model routing on Token Factory</div>
        <div className="mt-3 space-y-3">
          {byTier.map((t) => (
            <div key={t.tier}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium capitalize">Nemotron {t.tier}</span>
                <span className="font-mono text-xs text-muted">
                  {t.n} call{t.n === 1 ? "" : "s"} · {fmt(t.tokens)} tok
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/5">
                <div
                  className={`h-full rounded-full transition-[width] duration-700 ${t.tier === "nano" ? "bg-info" : t.tier === "super" ? "bg-warn" : "bg-accent"}`}
                  style={{ width: `${(t.tokens / maxTok) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {queries.length > 0 && (
        <div className="mt-5">
          <div className="text-xs text-muted">Searches planned by Nemotron Super</div>
          <ul className="mt-2 flex flex-col gap-1.5">
            {queries.map((q) => (
              <li key={q} className="truncate rounded-lg bg-black/25 px-3 py-1.5 font-mono text-[11px] ring-1 ring-white/5" title={q}>
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      {calls.length > 0 && (
        <div className="mt-5">
          <div className="text-xs text-muted">Calls</div>
          <ul className="mt-2 flex max-h-72 flex-col gap-1.5 overflow-auto">
            {calls.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-[11px]">
                <span className={`w-12 rounded px-1.5 py-0.5 text-center font-semibold capitalize ring-1 ${TIER_STYLE[c.tier]}`}>{c.tier}</span>
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
      {stages.verdict.status === "idle" && calls.length === 0 && <div className="mt-4 text-sm text-muted">Waiting for the first model call…</div>}
    </Panel>
  );
}
