// Stand-alone mock of the Token Factory OpenAI-compatible API for UI work without credits.
// Run: bun scripts/mock-tokenfactory.ts   (listens on 127.0.0.1:18555, exits after 20 minutes)
// Then: NEBIUS_API_KEY=mock NEBIUS_BASE_URL=http://127.0.0.1:18555/v1/ bun run dev
export {};
const port = Number(process.env.PORT ?? 18555);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname.endsWith("/models"))
      return Response.json({
        object: "list",
        data: ["nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", "nvidia/Nemotron-3-Super-120B-A12B", "nvidia/Nemotron-3-Ultra-550B-A55B"].map((id) => ({ id, object: "model" })),
      });
    const b = await req.json();
    const sys: string = b.messages[0].content;
    const user: string = b.messages[1].content;
    const pkg = user.match(/package: (\S+)/)?.[1] ?? user.match(/"([^"]+)"/)?.[1] ?? "pkg";
    let content: string;
    if (sys.includes("plan web searches")) {
      await sleep(600);
      content = JSON.stringify({ queries: [`${pkg} npm security incident`, `${pkg} npm maintainer change`, `${pkg} npm deprecated`, `${pkg} npm alternative`] });
    } else if (sys.includes("screen a project's dependencies")) {
      await sleep(500);
      const names = [...user.matchAll(/^(\S+?)(?:@|:)/gm)].map((m) => m[1]).filter((n) => n !== "Ecosystem");
      content = JSON.stringify({ items: names.map((name) => ({ name, risk: /DOES NOT EXIST/.test(user.split("\n").find((l) => l.startsWith(name)) ?? "") ? "high" : "low", reason: "Mock screening reason." })) });
    } else if (sys.includes("extract evidence")) {
      await sleep(400 + Math.random() * 500);
      const ids = [...user.matchAll(/id="(S\d+)"/g)].map((m) => m[1]);
      content = JSON.stringify({ items: ids.map((id, i) => ({ id, relevant: i !== 1, dimension: "security", severity: i === 0 ? "high" : "low", finding: `Mock finding for ${id}.` })) });
    } else {
      await sleep(2500);
      content = JSON.stringify({
        verdict: "caution", confidence: "medium", headline: `Mock verdict for ${pkg}`,
        summary: "This is a mock verdict produced without calling Nemotron.",
        scores: { security: 6, maintenance: 4, supplyChain: 5, popularity: 9, license: 10 },
        risks: [{ title: "Example risk", detail: "Illustrative only.", severity: "medium", citations: ["S1"] }],
        strengths: ["Permissive license"], alternatives: [{ name: "zod", why: "example" }], recommendation: "Mock recommendation.",
      });
    }
    return Response.json({
      id: "mock", object: "chat.completion", model: b.model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: Math.round(user.length / 4), completion_tokens: Math.round(content.length / 4), total_tokens: 0 },
    });
  },
});
console.log(`mock Token Factory on http://127.0.0.1:${port}/v1/`);
setTimeout(() => process.exit(0), 20 * 60_000);
