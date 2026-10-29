"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

/* ---------- small building blocks ---------- */

function Kicker({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-sm uppercase tracking-[0.2em] text-accent">{children}</div>;
}

function H({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`mt-4 text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl ${className}`}>{children}</h2>;
}

/** Reveals children in order once the slide is active. */
function Step({ i, active, children, className = "" }: { i: number; active: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`deck-step ${active ? "deck-in" : ""} ${className}`}
      style={{ transitionDelay: active ? `${120 + i * 110}ms` : "0ms" }}
    >
      {children}
    </div>
  );
}

function Shot({ src, alt, w, h, className = "" }: { src: string; alt: string; w: number; h: number; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-2xl border border-line shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] ${className}`}>
      <Image src={src} alt={alt} width={w} height={h} className="h-auto w-full" priority={false} />
    </div>
  );
}

/* ---------- slides ---------- */

type SlideFn = (active: boolean) => React.ReactNode;

const INCIDENTS = [
  { y: "2018", n: "event-stream", d: "New maintainer ships a wallet stealer to ~2M weekly installs" },
  { y: "2021", n: "ua-parser-js", d: "Hijacked account publishes a cryptominer and password stealer" },
  { y: "2022", n: "colors / faker", d: "The author sabotages their own packages; thousands of apps break" },
  { y: "2024", n: "xz-utils", d: "A two-year social-engineering campaign plants a backdoor" },
  { y: "now", n: "slopsquatting", d: "Attackers register package names AI assistants invent" },
];

const RESULTS = [
  { n: "event-stream", e: "npm", v: "avoid", why: "hijacked 2018, archived, maintainer was the attacker" },
  { n: "colors", e: "npm", v: "avoid", why: "sabotaged by its author, no release in 7 years" },
  { n: "request", e: "npm", v: "avoid", why: "deprecated, unpatched advisory in latest" },
  { n: "left-pad", e: "npm", v: "avoid", why: "deprecated; use native padStart" },
  { n: "lodahs", e: "npm", v: "avoid", why: "typosquat, replaced by npm as malware" },
  { n: "requests", e: "PyPI", v: "adopt", why: "16 old advisories, none affect 2.34.2" },
  { n: "zod", e: "npm", v: "adopt", why: "healthy; flags single-maintainer risk" },
];

const STAGES = [
  { t: "Collect facts", m: "no LLM", d: "npm · PyPI · OSV.dev · deps.dev · GitHub · OpenSSF Scorecard · provenance", c: "text-text" },
  { t: "Plan research", m: "Nemotron 3 Super", d: "4–5 targeted searches from the risks in the facts", c: "text-warn" },
  { t: "Search", m: "Tavily", d: "parallel queries, de-duplicated sources", c: "text-info" },
  { t: "Triage", m: "Nemotron 3 Nano ×5", d: "this exact package? which risk? how bad? in parallel", c: "text-info" },
  { t: "Verdict", m: "Nemotron 3 Ultra", d: "one reasoning call over facts plus distilled evidence", c: "text-accent" },
];

const SLIDES: { id: string; render: SlideFn; notes: string }[] = [
  {
    id: "title",
    notes: "Open on the question every developer skips.",
    render: (a) => (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <Step i={0} active={a}>
          <div className="font-mono text-sm uppercase tracking-[0.3em] text-muted">Nebius × NVIDIA Global AI Hackathon · Best Apps and Agents</div>
        </Step>
        <Step i={1} active={a}>
          <h1 className="mt-8 text-[9rem] font-semibold leading-none tracking-[-0.05em] sm:text-[12rem]">
            Vouch<span className="text-accent">.</span>
          </h1>
        </Step>
        <Step i={2} active={a}>
          <p className="mt-6 text-3xl text-muted">Should you trust this package?</p>
        </Step>
        <Step i={3} active={a}>
          <div className="mt-14 flex flex-wrap justify-center gap-3 font-mono text-sm">
            {["NVIDIA Nemotron 3", "Nebius Token Factory", "Tavily"].map((x) => (
              <span key={x} className="rounded-full border border-accent/40 bg-accent/10 px-4 py-2 text-accent">
                {x}
              </span>
            ))}
          </div>
        </Step>
      </div>
    ),
  },
  {
    id: "problem",
    notes: "Make it concrete: these are real, famous incidents.",
    render: (a) => (
      <div className="grid h-full items-center gap-16 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <Step i={0} active={a}>
            <Kicker>The problem</Kicker>
          </Step>
          <Step i={1} active={a}>
            <H>
              Every <span className="font-mono text-accent">install</span> runs a stranger&apos;s code.
            </H>
          </Step>
          <Step i={2} active={a}>
            <p className="mt-8 max-w-xl text-2xl leading-relaxed text-muted">
              With your permissions, on your laptop, in your CI, next to your secrets. Nobody reads ten tabs of research before adding a dependency.
            </p>
          </Step>
        </div>
        <div className="relative pl-8">
          <div className="absolute bottom-3 left-[7px] top-3 w-px bg-line" />
          {INCIDENTS.map((x, i) => (
            <Step key={x.n} i={i + 2} active={a} className="relative mb-7 last:mb-0">
              <span className={`absolute -left-8 top-2 h-[15px] w-[15px] rounded-full border-2 ${x.y === "now" ? "border-danger bg-danger" : "border-danger/70 bg-bg"}`} />
              <div className="flex items-baseline gap-4">
                <span className="w-14 font-mono text-sm text-muted">{x.y}</span>
                <span className="font-mono text-xl">{x.n}</span>
              </div>
              <p className="ml-[4.5rem] mt-1 text-lg text-muted">{x.d}</p>
            </Step>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: "slop",
    notes: "AI made it worse. This is the hook for an AI hackathon.",
    render: (a) => (
      <div className="flex h-full flex-col justify-center">
        <Step i={0} active={a}>
          <Kicker>And AI made it worse</Kicker>
        </Step>
        <div className="mt-6 grid items-center gap-16 lg:grid-cols-[1fr_1fr]">
          <div>
            <Step i={1} active={a}>
              <div className="text-[10rem] font-semibold leading-none tracking-tighter text-danger">
                1<span className="mx-6 text-[5rem] text-muted">in</span>5
              </div>
            </Step>
            <Step i={2} active={a}>
              <p className="mt-6 max-w-lg text-2xl leading-relaxed">
                package names recommended by code-generating LLMs <b>don&apos;t exist</b>.
              </p>
              <p className="mt-3 max-w-lg text-base text-muted">
                19.7% across 576k generated samples and 16 models. Spracklen et al., &ldquo;We Have a Package for You!&rdquo;, USENIX Security 2025.
              </p>
            </Step>
          </div>
          <Step i={3} active={a}>
            <div className="rounded-2xl border border-line bg-panel p-8 font-mono text-lg leading-loose">
              <div className="text-muted"># your assistant suggests:</div>
              <div>
                <span className="text-accent">$</span> pip install <span className="text-danger underline decoration-wavy underline-offset-4">reqeusts</span>
              </div>
              <div className="mt-6 text-muted"># today: 404 not found</div>
              <div className="text-muted"># tomorrow: whatever an attacker uploads</div>
              <div className="mt-6 text-warn">→ &ldquo;slopsquatting&rdquo;</div>
            </div>
          </Step>
        </div>
      </div>
    ),
  },
  {
    id: "product",
    notes: "One input, one cited verdict. Show the real screenshot.",
    render: (a) => (
      <div className="grid h-full items-center gap-14 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <Step i={0} active={a}>
            <Kicker>Vouch</Kicker>
          </Step>
          <Step i={1} active={a}>
            <H>
              Type a name.
              <br />
              Get a <span className="text-accent">cited</span> verdict.
            </H>
          </Step>
          <Step i={2} active={a}>
            <ul className="mt-10 space-y-4 text-xl">
              {[
                ["Adopt · Caution · Avoid", "with a confidence level"],
                ["Five risk scores", "security, maintenance, supply chain, adoption, license"],
                ["Every claim cited", "to an OSV advisory or a web source"],
                ["Safer alternatives", "one click to vet each"],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-2.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                  <span>
                    <b>{t}</b> <span className="text-muted">{d}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Step>
        </div>
        <Step i={2} active={a} className="max-h-[78vh] overflow-hidden rounded-2xl">
          <Shot src="/pitch/img/verdict.png" alt="Vouch verdict for event-stream: Avoid, high confidence, with cited risks" w={1664} h={3290} />
        </Step>
      </div>
    ),
  },
  {
    id: "pipeline",
    notes: "Facts first, so the important things cannot be hallucinated. Then right-sized models.",
    render: (a) => (
      <div className="flex h-full flex-col justify-center">
        <Step i={0} active={a}>
          <Kicker>How it works</Kicker>
        </Step>
        <Step i={1} active={a}>
          <H>Facts first. Then the right model for each job.</H>
        </Step>
        <div className="mt-14 grid gap-4 lg:grid-cols-5">
          {STAGES.map((s, i) => (
            <Step key={s.t} i={i + 2} active={a} className="relative">
              <div className={`h-full rounded-2xl border bg-panel p-6 ${i === 4 ? "border-accent/60" : "border-line"}`}>
                <div className="font-mono text-sm text-muted">0{i + 1}</div>
                <div className="mt-3 text-2xl font-semibold">{s.t}</div>
                <div className={`mt-2 font-mono text-sm ${s.c}`}>{s.m}</div>
                <p className="mt-4 text-base leading-relaxed text-muted">{s.d}</p>
              </div>
              {i < 4 && <div className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 text-2xl text-accent lg:block">›</div>}
            </Step>
          ))}
        </div>
        <Step i={8} active={a}>
          <p className="mt-10 text-xl text-muted">
            Every step streams to the UI. Facts appear in about a second. If the models are down, you still get a rule-based verdict.
          </p>
        </Step>
      </div>
    ),
  },
  {
    id: "routing",
    notes: "This is the track ask: Ultra for serious reasoning, Nano/Super for fast calls. Real numbers.",
    render: (a) => (
      <div className="grid h-full items-center gap-16 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <Step i={0} active={a}>
            <Kicker>Model routing on Token Factory</Kicker>
          </Step>
          <Step i={1} active={a}>
            <H>
              Ultra thinks <span className="text-accent">once</span>.
              <br />
              Nano does the volume.
            </H>
          </Step>
          <div className="mt-12 space-y-5">
            {[
              { t: "Nano", calls: "4–6", tok: 5900, ms: "1–10 s each", role: "triage, in parallel", cls: "bg-info" },
              { t: "Super", calls: "1", tok: 560, ms: "0.7 s", role: "plan research", cls: "bg-warn" },
              { t: "Ultra", calls: "1", tok: 3700, ms: "9–16 s", role: "reasoned verdict", cls: "bg-accent" },
            ].map((r, i) => (
              <Step key={r.t} i={i + 2} active={a}>
                <div className="flex items-center gap-5">
                  <span className="w-20 text-xl font-semibold">{r.t}</span>
                  <div className="h-10 flex-1 overflow-hidden rounded-lg bg-panel-2">
                    <div
                      className={`deck-bar flex h-full items-center whitespace-nowrap rounded-lg px-3 font-mono text-sm text-black ${r.cls}`}
                      style={{ width: a ? `${Math.max(18, (r.tok / 5900) * 100)}%` : "0%", transitionDelay: `${400 + i * 150}ms` }}
                    >
                      {(r.tok / 1000).toFixed(1)}k tok
                    </div>
                  </div>
                  <span className="w-56 whitespace-nowrap text-right text-base text-muted">
                    {r.calls} call{r.calls === "1" ? "" : "s"} · {r.ms}
                  </span>
                </div>
                <div className="ml-[6.25rem] mt-1 text-sm text-muted">{r.role}</div>
              </Step>
            ))}
          </div>
          <Step i={6} active={a}>
            <p className="mt-10 text-lg text-muted">
              Ultra never sees raw web pages, only evidence Nano already filtered. One full investigation: about 7 calls, 10k tokens, 20–28 s.
            </p>
          </Step>
        </div>
        <Step i={3} active={a} className="justify-self-center">
          <Shot src="/pitch/img/trace.png" alt="Agent trace panel showing per-call model routing" w={720} h={1396} className="max-h-[78vh] w-[360px]" />
        </Step>
      </div>
    ),
  },
  {
    id: "finding",
    notes: "The engineering story. Real bug, real measurement, real feedback for Nebius.",
    render: (a) => (
      <div className="flex h-full flex-col justify-center">
        <Step i={0} active={a}>
          <Kicker>What we learned the hard way</Kicker>
        </Step>
        <Step i={1} active={a}>
          <H>Our first live run returned nothing.</H>
        </Step>
        <div className="mt-12 grid gap-10 lg:grid-cols-2">
          <Step i={2} active={a}>
            <p className="text-2xl leading-relaxed text-muted">
              Nemotron 3 reasons by default. Nano spent its whole token budget <i>thinking</i> about one-line classifications, so the triage stage returned no
              evidence. <span className="font-mono text-text">/no_think</span> had no effect on Token Factory.
            </p>
            <div className="mt-8 rounded-2xl border border-accent/40 bg-accent/5 p-6 font-mono text-lg">
              <span className="text-muted">{"// what actually works"}</span>
              <br />
              chat_template_kwargs: {"{"} <span className="text-accent">enable_thinking: false</span> {"}"}
            </div>
          </Step>
          <div className="grid grid-cols-2 gap-6">
            {[
              { k: "faster", v: "3×", d: "0.9 s → 0.3 s per extraction call" },
              { k: "fewer tokens", v: "5×", d: "96 → 18 completion tokens" },
              { k: "relevant sources", v: "0 → 11", d: "on event-stream after the fix" },
              { k: "reasoning", v: "Ultra only", d: "where calibration matters" },
            ].map((x, i) => (
              <Step key={x.k} i={i + 3} active={a}>
                <div className="h-full rounded-2xl border border-line bg-panel p-6">
                  <div className="text-5xl font-semibold tracking-tight text-accent">{x.v}</div>
                  <div className="mt-2 text-lg">{x.k}</div>
                  <div className="mt-1 text-sm text-muted">{x.d}</div>
                </div>
              </Step>
            ))}
          </div>
        </div>
      </div>
    ),
  },
  {
    id: "scan",
    notes: "Scales to a whole project. Same routing idea, applied to a manifest.",
    render: (a) => (
      <div className="grid h-full items-center gap-14 lg:grid-cols-[0.75fr_1.25fr]">
        <div>
          <Step i={0} active={a}>
            <Kicker>Scale it to a project</Kicker>
          </Step>
          <Step i={1} active={a}>
            <H>Paste a package.json.</H>
          </Step>
          <Step i={2} active={a}>
            <p className="mt-8 text-2xl leading-relaxed text-muted">
              Facts for every dependency in parallel. Nano screens them eight at a time. Risky ones float to the top, and <b className="text-text">Deep dive</b> sends
              only those to Ultra.
            </p>
          </Step>
          <Step i={3} active={a}>
            <div className="mt-10 flex gap-10">
              <div>
                <div className="text-5xl font-semibold text-accent">~4 s</div>
                <div className="mt-1 text-muted">9 dependencies</div>
              </div>
              <div>
                <div className="text-5xl font-semibold text-accent">2</div>
                <div className="mt-1 text-muted">Nano calls</div>
              </div>
            </div>
          </Step>
          <Step i={4} active={a}>
            <p className="mt-8 text-base text-muted">The table sorts by the worse of the rule-based and model opinion, so a model can never hide a hard red flag.</p>
          </Step>
        </div>
        <Step i={2} active={a}>
          <Shot src="/pitch/img/scan.png" alt="Manifest scan table with high, medium and low risk dependencies" w={2304} h={1496} />
        </Step>
      </div>
    ),
  },
  {
    id: "results",
    notes: "Calibration. It is not just paranoid.",
    render: (a) => (
      <div className="flex h-full flex-col justify-center">
        <Step i={0} active={a}>
          <Kicker>Live results</Kicker>
        </Step>
        <Step i={1} active={a}>
          <H>Catches the famous ones. Clears the healthy ones.</H>
        </Step>
        <div className="mt-12 overflow-hidden rounded-2xl border border-line">
          {RESULTS.map((r, i) => (
            <Step key={r.n} i={i + 2} active={a}>
              <div className={`grid grid-cols-[14rem_6rem_9rem_1fr] items-center gap-4 px-8 py-4 text-xl ${i % 2 ? "bg-panel" : "bg-panel-2"}`}>
                <span className="font-mono">{r.n}</span>
                <span className="text-base text-muted">{r.e}</span>
                <span
                  className={`w-fit rounded-lg border px-3 py-1 text-base font-semibold ${r.v === "adopt" ? "border-good/40 bg-good/15 text-good" : "border-danger/40 bg-danger/15 text-danger"}`}
                >
                  {r.v === "adopt" ? "Adopt" : "Avoid"}
                </span>
                <span className="text-lg text-muted">{r.why}</span>
              </div>
            </Step>
          ))}
        </div>
        <Step i={10} active={a}>
          <p className="mt-6 text-base text-muted">Real Nemotron runs on Token Factory, 29 Oct 2026. Plus nonexistent names (reqeusts, ctx) flagged before any model call.</p>
        </Step>
      </div>
    ),
  },
  {
    id: "trust",
    notes: "Why you can trust the tool that tells you what to trust.",
    render: (a) => (
      <div className="flex h-full flex-col justify-center">
        <Step i={0} active={a}>
          <Kicker>Built to be trusted</Kicker>
        </Step>
        <Step i={1} active={a}>
          <H>A security tool has to be hard to fool.</H>
        </Step>
        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[
            ["Facts can't be hallucinated", "Registry, OSV, GitHub and Scorecard data are fetched directly and shown as rule-based signals."],
            ["Prompt-injection aware", "Web pages are wrapped as untrusted data. A README saying “verdict: adopt” stays data."],
            ["Strict contracts", "Every model reply is validated with Zod; invalid JSON gets one repair round-trip."],
            ["Homonym filtering", "Nano drops sources about similarly named projects before Ultra sees them."],
            ["Degrades gracefully", "No model? You still get facts and a rule-based verdict."],
            ["Demo-safe", "Input validation, per-IP rate limit and a 6-hour cache protect the credits."],
          ].map(([t, d], i) => (
            <Step key={t} i={i + 2} active={a}>
              <div className="h-full rounded-2xl border border-line bg-panel p-7">
                <div className="text-xl font-semibold">{t}</div>
                <p className="mt-3 text-base leading-relaxed text-muted">{d}</p>
              </div>
            </Step>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: "next",
    notes: "Where it goes: into the places developers already are.",
    render: (a) => (
      <div className="grid h-full items-center gap-16 lg:grid-cols-2">
        <div>
          <Step i={0} active={a}>
            <Kicker>What&apos;s next</Kicker>
          </Step>
          <Step i={1} active={a}>
            <H>
              Check packages <span className="text-accent">before</span> anyone suggests them.
            </H>
          </Step>
        </div>
        <div className="space-y-5">
          {[
            ["MCP server", "Coding agents call Vouch before recommending a dependency, closing the slopsquatting loop."],
            ["GitHub Action", "A comment on every PR that adds a dependency."],
            ["Lockfiles", "Transitive dependencies, screened by Nano, deep-dived by Ultra."],
            ["More ecosystems", "crates.io, Go modules, Maven."],
          ].map(([t, d], i) => (
            <Step key={t} i={i + 2} active={a}>
              <div className="flex gap-5 rounded-2xl border border-line bg-panel p-6">
                <span className="font-mono text-2xl text-accent">0{i + 1}</span>
                <div>
                  <div className="text-xl font-semibold">{t}</div>
                  <p className="mt-1 text-base text-muted">{d}</p>
                </div>
              </div>
            </Step>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: "close",
    notes: "Close on the tagline and the links.",
    render: (a) => (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <Step i={0} active={a}>
          <h1 className="text-[8rem] font-semibold leading-none tracking-[-0.05em] sm:text-[10rem]">
            Vouch<span className="text-accent">.</span>
          </h1>
        </Step>
        <Step i={1} active={a}>
          <p className="mt-6 text-4xl">Know what you install.</p>
        </Step>
        <Step i={2} active={a}>
          <div className="mt-14 flex flex-wrap justify-center gap-4 text-lg">
            <Link href="/" className="rounded-xl bg-accent px-6 py-3 font-semibold text-black hover:opacity-90">
              Try it live
            </Link>
            <a
              href="https://github.com/lassestilvang/vouch"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border border-line bg-panel px-6 py-3 font-mono hover:border-accent"
            >
              github.com/lassestilvang/vouch
            </a>
          </div>
        </Step>
        <Step i={3} active={a}>
          <p className="mt-10 font-mono text-sm text-muted">MIT licensed · NVIDIA Nemotron 3 Nano · Super · Ultra on Nebius Token Factory · Tavily</p>
        </Step>
      </div>
    ),
  },
];

/* ---------- deck shell ---------- */

export default function Deck() {
  const [i, setI] = useState(0);
  const [notes, setNotes] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const n = SLIDES.length;
  const go = useCallback((to: number) => setI(Math.max(0, Math.min(n - 1, to))), [n]);

  useEffect(() => {
    const fromHash = Number(window.location.hash.slice(1));
    // Deep link to a slide (#4); scheduled so the state update isn't synchronous in the effect.
    if (fromHash >= 1 && fromHash <= n) queueMicrotask(() => setI(fromHash - 1));
  }, [n]);

  useEffect(() => {
    window.history.replaceState(null, "", `#${i + 1}`);
  }, [i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) {
        e.preventDefault();
        go(i + 1);
      } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) {
        e.preventDefault();
        go(i - 1);
      } else if (e.key === "Home") go(0);
      else if (e.key === "End") go(n - 1);
      else if (e.key === "f" || e.key === "F") {
        if (document.fullscreenElement) document.exitFullscreen();
        else rootRef.current?.requestFullscreen();
      } else if (e.key === "n" || e.key === "N") setNotes((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, n, go]);

  // Swipe on touch devices.
  const touchX = useRef<number | null>(null);

  return (
    <div
      ref={rootRef}
      className="deck relative h-dvh w-full overflow-hidden bg-bg text-text select-none"
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1));
        touchX.current = null;
      }}
    >
      <div className="deck-glow pointer-events-none absolute inset-0" aria-hidden />

      {SLIDES.map((s, k) => (
        <section
          key={s.id}
          aria-hidden={k !== i}
          aria-label={`Slide ${k + 1} of ${n}`}
          className={`deck-slide absolute inset-0 px-10 py-16 sm:px-20 lg:px-28 ${k === i ? "deck-active" : k < i ? "deck-past" : "deck-future"}`}
        >
          <div className="mx-auto h-full max-w-[1500px]">{s.render(k === i)}</div>
        </section>
      ))}

      {/* chrome */}
      <div className="absolute left-0 right-0 top-0 h-1 bg-line/60">
        <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${((i + 1) / n) * 100}%` }} />
      </div>
      <div className="absolute bottom-6 left-10 font-mono text-sm text-muted sm:left-20 lg:left-28">
        Vouch<span className="text-accent">.</span>
      </div>
      <div className="absolute bottom-5 right-8 flex items-center gap-3 font-mono text-sm text-muted">
        <button onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous slide" className="rounded-md px-2 py-1 hover:text-text disabled:opacity-30">
          ←
        </button>
        <span>
          {String(i + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
        </span>
        <button onClick={() => go(i + 1)} disabled={i === n - 1} aria-label="Next slide" className="rounded-md px-2 py-1 hover:text-text disabled:opacity-30">
          →
        </button>
      </div>
      {i === 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 font-mono text-xs text-muted">→ / space to advance · F fullscreen · N notes</div>
      )}
      {notes && (
        <div className="absolute bottom-16 left-1/2 max-w-2xl -translate-x-1/2 rounded-xl border border-line bg-panel/95 px-5 py-3 text-sm text-muted">
          <span className="text-accent">Notes: </span>
          {SLIDES[i].notes}
        </div>
      )}
    </div>
  );
}
