// End-to-end pipeline test against an in-process mock of the Token Factory API.
// Exercises model discovery, tier routing, JSON repair (fences, <think> blocks,
// string numbers) and the event stream, without spending credits.
// Run: bun scripts/mock-test.ts
export {};
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname.endsWith("/models"))
      return Response.json({
        object: "list",
        data: [
          "meta-llama/Llama-3.3-70B",
          "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
          "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-FP8",
          "nvidia/Nemotron-3-Super-120B-A12B",
          "nvidia/Nemotron-3-Ultra-550B-A55B",
        ].map((id) => ({ id, object: "model" })),
      });
    const b = await req.json();
    const sys: string = b.messages[0].content;
    let content: string;
    if (sys.includes("plan web searches"))
      content = '{"queries":["event-stream npm flatmap-stream malware","event-stream npm maintainer handoff","event-stream npm alternative"]}';
    else if (sys.includes("extract evidence")) {
      const ids = [...String(b.messages[1].content).matchAll(/id="(S\d+)"/g)].map((m) => m[1]);
      content = "```json\n" + JSON.stringify({ items: ids.map((id, i) => ({ id, relevant: i % 2 === 0, dimension: "security", severity: "high", finding: `Finding for ${id}.` })) }) + "\n```";
    } else
      content =
        '<think>weigh things {not json}</think>{"verdict":"avoid","confidence":"high","headline":"Compromised in 2018 and abandoned since","summary":"x","scores":{"security":2,"maintenance":1,"supplyChain":1,"popularity":"8","license":9},"risks":[{"title":"Malicious dependency","detail":"d","severity":"critical","citations":["S1","GHSA-mh6f-8j2x-4483"]}],"strengths":["MIT"],"alternatives":[{"name":"through2","why":"maintained"}],"recommendation":"Do not use."}';
    return Response.json({
      id: "x",
      object: "chat.completion",
      model: b.model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });
  },
});

process.env.NEBIUS_API_KEY = "test";
process.env.NEBIUS_BASE_URL = `http://127.0.0.1:${server.port}/v1/`;
const { vet } = await import("../src/lib/agent");
const { resolveModels } = await import("../src/lib/llm");

const failures: string[] = [];
const check = (ok: boolean, msg: string) => (ok ? console.log("ok  ", msg) : (failures.push(msg), console.log("FAIL", msg)));

const models = await resolveModels();
check(models.nano === "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", `nano -> ${models.nano}`);
check(models.super === "nvidia/Nemotron-3-Super-120B-A12B", `super -> ${models.super}`);
check(models.ultra === "nvidia/Nemotron-3-Ultra-550B-A55B", `ultra -> ${models.ultra}`);

const events: { type: string; [k: string]: unknown }[] = [];
await vet("npm", "event-stream", (e) => events.push(e as never), { fresh: true });
const calls = events.filter((e) => e.type === "llm").map((e) => e.call as { stage: string; tier: string; ok: boolean });
check(calls.some((c) => c.stage === "plan" && c.tier === "super" && c.ok), "plan ran on super");
check(calls.filter((c) => c.stage === "triage" && c.tier === "nano").length >= 1, `triage ran on nano (${calls.filter((c) => c.stage === "triage").length} calls)`);
check(calls.some((c) => c.stage === "verdict" && c.tier === "ultra" && c.ok), "verdict ran on ultra");
const q = events.find((e) => e.type === "queries") as { queries: string[] } | undefined;
check(!!q?.queries[0]?.includes("flatmap"), "planner queries used");
const v = events.find((e) => e.type === "verdict") as { verdict: { verdict: string; scores: { popularity: number } } } | undefined;
check(v?.verdict.verdict === "avoid" && v.verdict.scores.popularity === 8, "verdict parsed through <think> and string number");
check(events.at(-1)?.type === "done", "stream ends with done");

server.stop(true);
if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nall checks passed");
