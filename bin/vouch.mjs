#!/usr/bin/env node
// vouch: put a supply-chain check in front of `npm install` / `pip install`.
//
//   vouch npm install event-stream     # vets each package, installs only if none is "avoid"
//   vouch pip install requests
//   vouch check npm lodahs             # report only, never installs
//
// Options: --yes (also install on "caution"), --dry-run (never install), --api <url>
// Env: VOUCH_API (default https://vouch-phi-one.vercel.app)
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const flag = (f) => {
  const i = args.indexOf(f);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const opt = (f) => {
  const i = args.indexOf(f);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const yes = flag("--yes") || flag("-y");
const dryRun = flag("--dry-run");
const API = (opt("--api") ?? process.env.VOUCH_API ?? "https://vouch-phi-one.vercel.app").replace(/\/$/, "");
// Base for the "details" link; differs from API when pointing at a local server.
const LINK = (process.env.VOUCH_LINK ?? API).replace(/\/$/, "");
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const tty = process.stdout.isTTY || process.env.FORCE_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = c("2");
const bold = c("1");
const red = c("31");
const green = c("32");
const yellow = c("33");
const cyan = c("36");
const lime = c("92");
const out = (s = "") => process.stdout.write(s + "\n");

function usage() {
  out(`${bold("vouch")} · know what you install\n`);
  out("  vouch npm install <pkg...>    vet, then install if safe");
  out("  vouch pip install <pkg...>");
  out("  vouch check <npm|pypi> <pkg>  vet only");
  out(`\n  ${dim("--yes  install on caution too · --dry-run  never install · --api <url>")}`);
  process.exit(2);
}

let ecosystem;
let pkgs;
let installCmd;
const [tool, sub, ...rest] = args;
if (tool === "check") {
  ecosystem = sub === "pypi" || sub === "pip" ? "pypi" : "npm";
  pkgs = rest;
} else if ((tool === "npm" || tool === "pnpm" || tool === "yarn" || tool === "bun") && ["i", "install", "add"].includes(sub)) {
  ecosystem = "npm";
  pkgs = rest.filter((a) => !a.startsWith("-"));
  installCmd = [tool, sub, ...rest];
} else if ((tool === "pip" || tool === "pip3" || tool === "uv") && ["install", "add"].includes(sub)) {
  ecosystem = "pypi";
  pkgs = rest.filter((a) => !a.startsWith("-") && !a.startsWith("."));
  installCmd = [tool, sub, ...rest];
} else usage();
if (!pkgs.length) usage();

// Strip version specifiers: lodash@4, requests==2.31, flask>=3
const bare = (p) => (ecosystem === "npm" ? p.replace(/(.+?)@[^/]*$/, "$1") : p.split(/[=<>!~;[ ]/)[0]);

const STAGE = {
  collect: ["Facts", "registry · OSV · GitHub", cyan],
  plan: ["Plan", "Nemotron Super", yellow],
  search: ["Search", "Tavily", c("35")],
  triage: ["Triage", "Nemotron Nano", c("34")],
  verdict: ["Verdict", "Nemotron Ultra", lime],
};

async function vet(name) {
  const res = await fetch(`${API}/api/vet`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ecosystem, name }),
  });
  if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  const t0 = Date.now();
  let verdict;
  let facts;
  let nano = 0;
  let total;
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
      const e = JSON.parse(line);
      if (e.type === "facts") facts = e.facts;
      if (e.type === "llm" && e.call.tier === "nano" && e.call.ok) nano++;
      if (e.type === "stage" && e.status === "done") {
        const [label, who, col] = STAGE[e.stage];
        // Server offsets keep timings honest when the server replays a cached run.
        const t = dim(`${((e.t ?? Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`);
        let note = e.note ? dim(` · ${e.note}`) : "";
        if (e.stage === "triage" && nano) note = dim(` · ${nano} parallel calls`) + note;
        out(`  ${t}  ${green("✓")} ${label.padEnd(7)} ${col(who)}${note}`);
      }
      if (e.type === "cached") out(`  ${dim(`cached result from a live run ${Math.max(1, Math.round(e.ageMs / 60000))} min ago`)}`);
      if (e.type === "done") total = e.ms;
      if (e.type === "verdict") verdict = e.verdict;
      if (e.type === "error") throw new Error(e.message);
    }
  }
  return { verdict, facts, ms: total ?? Date.now() - t0 };
}

const STYLE = {
  avoid: (s) => (tty ? `\x1b[1;37;41m ${s} \x1b[0m` : `[${s}]`),
  caution: (s) => (tty ? `\x1b[1;30;43m ${s} \x1b[0m` : `[${s}]`),
  adopt: (s) => (tty ? `\x1b[1;30;42m ${s} \x1b[0m` : `[${s}]`),
};

let blocked = 0;
let warned = 0;
for (const raw of pkgs) {
  const name = bare(raw);
  out(`\n${lime("▲ vouch")} ${dim("investigating")} ${bold(name)} ${dim(`(${ecosystem})`)}`);
  let r;
  try {
    r = await vet(name);
  } catch (err) {
    out(`  ${yellow("!")} could not vet ${name}: ${err.message}`);
    warned++;
    continue;
  }
  const v = r.verdict;
  if (!v) {
    warned++;
    continue;
  }
  out("");
  out(`  ${STYLE[v.verdict](v.verdict.toUpperCase())}  ${bold(v.headline)}`);
  for (const risk of v.risks.slice(0, 3)) {
    const sev = risk.severity === "critical" || risk.severity === "high" ? red(risk.severity.toUpperCase()) : yellow(risk.severity.toUpperCase());
    out(`    ${sev.padEnd(tty ? 17 : 8)} ${clip(risk.title.split(/(?<=\.) /)[0], 72)}`);
  }
  if (v.alternatives?.length) out(`    ${dim("try instead:")} ${v.alternatives.map((a) => cyan(a.name)).join(dim(", "))}`);
  else if (r.facts && !r.facts.exists && r.facts.typosquatOf?.[0]) out(`    ${dim("did you mean")} ${cyan(r.facts.typosquatOf[0].name)}${dim("?")}`);
  out(`    ${dim(`${(r.ms / 1000).toFixed(1)}s · details ${LINK}/?e=${ecosystem}&p=${encodeURIComponent(name)}`)}`);
  if (v.verdict === "avoid") blocked++;
  if (v.verdict === "caution") warned++;
}

out("");
if (blocked) {
  out(`${red("✕")} ${bold(`Install blocked.`)} ${blocked} package${blocked > 1 ? "s" : ""} rated ${red("avoid")}.`);
  process.exit(1);
}
if (warned && !yes) {
  out(`${yellow("!")} ${bold("Not installing.")} Re-run with ${bold("--yes")} to accept packages rated caution.`);
  process.exit(1);
}
if (!installCmd || dryRun) {
  out(`${green("✓")} ${bold("All clear.")}${installCmd ? dim(" (dry run, not installing)") : ""}`);
  process.exit(0);
}
out(`${green("✓")} ${bold("All clear.")} ${dim("running")} ${installCmd.join(" ")}\n`);
const child = spawn(installCmd[0], installCmd.slice(1), { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
