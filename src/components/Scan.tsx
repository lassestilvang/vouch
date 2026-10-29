"use client";

import { useState } from "react";
import type { Ecosystem, LlmCall, ScanEvent, ScanRow } from "@/lib/types";

const SAMPLE_NPM = JSON.stringify(
  {
    name: "my-app",
    dependencies: { react: "^19.0.0", "event-stream": "3.3.6", lodahs: "^1.0.0", colors: "1.4.0", zod: "^4.0.0", "react-scripts-helper-utils": "^2.1.0" },
    devDependencies: { typescript: "^5.9.0", eslint: "^9.0.0" },
  },
  null,
  2,
);
const SAMPLE_PY = "requests>=2.31\nnumpy==2.1.0\nreqeusts==2.31.0\npython-dateutil\nflask\nctx==0.2.6\n";

const RISK_STYLE = {
  high: "bg-danger/15 text-danger",
  medium: "bg-warn/15 text-warn",
  low: "bg-good/15 text-good",
} as const;
const RANK = { high: 0, medium: 1, low: 2 } as const;
const fmt = (n?: number) => (n === undefined ? "–" : Intl.NumberFormat("en", { notation: "compact" }).format(n));

export default function Scan({ onDeepDive }: { onDeepDive: (e: Ecosystem, name: string) => void }) {
  const [text, setText] = useState("");
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [meta, setMeta] = useState<Extract<ScanEvent, { type: "manifest" }> | null>(null);
  const [calls, setCalls] = useState<LlmCall[]>([]);
  const [ms, setMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(manifest: string) {
    setText(manifest);
    setRunning(true);
    setRows([]);
    setMeta(null);
    setCalls([]);
    setMs(null);
    setError(null);
    try {
      const res = await fetch("/api/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ manifest }) });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `request failed (${res.status})`);
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
          if (!line) continue;
          const e = JSON.parse(line) as ScanEvent;
          if (e.type === "manifest") setMeta(e);
          else if (e.type === "row") setRows((r) => [...r, e.row]);
          else if (e.type === "screen") {
            const by = new Map(e.items.map((x) => [x.name, x]));
            setRows((r) => r.map((row) => (by.has(row.name) ? { ...row, risk: by.get(row.name)!.risk, reason: by.get(row.name)!.reason } : row)));
          } else if (e.type === "llm") setCalls((c) => [...c, e.call]);
          else if (e.type === "error") setError(e.message);
          else if (e.type === "done") setMs(e.ms);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  // The worse of the rule-based and model opinions decides the order, so a model can't hide a hard red flag.
  const effective = (r: ScanRow) => (r.risk && RANK[r.risk] < RANK[r.ruleRisk] ? r.risk : r.ruleRisk);
  const sorted = [...rows].sort((a, b) => RANK[effective(a)] - RANK[effective(b)] || a.name.localeCompare(b.name));
  const counts = { high: 0, medium: 0, low: 0 };
  for (const r of rows) counts[effective(r)]++;
  const tokens = calls.reduce((a, c) => a + (c.promptTokens ?? 0) + (c.completionTokens ?? 0), 0);

  return (
    <div className="mt-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start(text);
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          spellCheck={false}
          aria-label="Manifest"
          placeholder="Paste a package.json or requirements.txt (up to 40 dependencies)"
          className="glass w-full rounded-2xl px-5 py-4 font-mono text-sm outline-none placeholder:text-white/25 focus:border-accent/50"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={running || !text.trim()}
            className="rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-40"
          >
            {running ? "Scanning…" : "Scan dependencies"}
          </button>
          <span className="text-xs text-muted">Samples:</span>
          <button
            type="button"
            disabled={running}
            onClick={() => start(SAMPLE_NPM)}
            className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-sm hover:border-accent/60"
          >
            package.json
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => start(SAMPLE_PY)}
            className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-sm hover:border-accent/60"
          >
            requirements.txt
          </button>
        </div>
      </form>

      {error && <div className="mt-6 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

      {meta && (
        <section data-demo="scan" className="glass rise mt-6 overflow-hidden rounded-3xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-6 py-4 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">
                {rows.length}/{meta.total} {meta.kind} dependencies
              </span>
              {(["high", "medium", "low"] as const).map((k) => (
                <span key={k} className={`rounded-md px-2.5 py-1 text-xs font-semibold ${RISK_STYLE[k]}`}>
                  {counts[k]} {k}
                </span>
              ))}
            </div>
            <span className="text-xs text-muted">
              {calls.length > 0 && `Nemotron Nano · ${calls.filter((c) => c.ok).length} screening calls · ${fmt(tokens)} tokens · `}
              {ms !== null ? `${(ms / 1000).toFixed(1)}s` : running ? "running…" : ""}
            </span>
          </div>
          {(meta.skipped.length > 0 || meta.truncated > 0) && (
            <p className="border-b border-white/5 px-6 py-2 text-xs text-muted">
              {meta.truncated > 0 && `Only the first ${meta.total} dependencies were scanned. `}
              {meta.skipped.length > 0 && `Skipped non-registry entries: ${meta.skipped.slice(0, 6).join(", ")}${meta.skipped.length > 6 ? "…" : ""}`}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-white/5">
                  <th className="px-6 py-3 font-normal">Risk</th>
                  <th className="px-2 py-2 font-normal">Package</th>
                  <th className="px-2 py-2 font-normal">Why</th>
                  <th className="px-2 py-2 text-right font-normal">Downloads/wk</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const risk = effective(r);
                  const flags = r.signals.filter((s) => s.level === "danger" || s.level === "warn");
                  return (
                    <tr key={r.name} className="border-b border-white/5 align-top transition last:border-0 hover:bg-white/[0.02]">
                      <td className="px-6 py-4">
                        <span className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase ${RISK_STYLE[risk]}`}>{risk}</span>
                      </td>
                      <td className="px-2 py-4">
                        <div className="font-mono text-base">{r.name}</div>
                        <div className="font-mono text-xs text-muted">
                          {r.spec || "any"}
                          {r.latestVersion && ` → ${r.latestVersion}`}
                          {r.dev && " · dev"}
                        </div>
                      </td>
                      <td className="max-w-md px-2 py-4">
                        {r.reason ? <div>{r.reason}</div> : running && <div className="text-muted">screening…</div>}
                        {flags.length > 0 && (
                          <div className="mt-1 text-xs text-muted">
                            {flags
                              .slice(0, 3)
                              .map((f) => f.text)
                              .join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-4 text-right font-mono text-sm">{fmt(r.weeklyDownloads)}</td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => onDeepDive(meta.ecosystem, r.name)}
                          className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${risk === "low" ? "text-muted ring-1 ring-white/10 hover:text-text" : "bg-accent text-black hover:brightness-110"}`}
                        >
                          Deep dive
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!meta && !running && (
        <p className="mt-6 text-sm text-muted">
          Every dependency gets the fact checks plus a screening pass by Nemotron Nano, at about one cheap call per eight packages. Pick the risky ones for a
          full investigation with web research and a Nemotron Ultra verdict.
        </p>
      )}
    </div>
  );
}
