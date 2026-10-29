// Live check against the real Token Factory: confirms the Nemotron models resolve and
// each tier returns valid JSON, then runs one full vet and prints the numbers the
// Devpost write-up needs. Uses a few cents of credits.
// Run: bun --env-file=.env.local scripts/live-check.ts [ecosystem] [package]
export {};
const { resolveModels, jsonCall } = await import("../src/lib/llm");
const { vet } = await import("../src/lib/agent");
const { z } = await import("zod");

if (!process.env.NEBIUS_API_KEY) {
  console.error("NEBIUS_API_KEY is not set (put it in .env.local)");
  process.exit(1);
}

const models = await resolveModels();
console.log("models:", models);

for (const tier of ["nano", "super", "ultra"] as const) {
  const t0 = Date.now();
  try {
    const r = await jsonCall({
      tier,
      stage: "plan",
      think: tier === "ultra",
      maxTokens: tier === "ultra" ? 3000 : 200,
      schema: z.object({ ok: z.boolean(), word: z.string() }),
      system: "You are a test endpoint.",
      user: 'Return {"ok": true, "word": "<any fruit>"}',
      onCall: (c) => !c.ok && console.log(`  ${tier}: ${c.error}`),
    });
    console.log(`${tier.padEnd(5)} ok in ${Date.now() - t0} ms ->`, r);
  } catch (e) {
    console.log(`${tier.padEnd(5)} FAILED after ${Date.now() - t0} ms: ${(e as Error).message}`);
  }
}

const [eco, name] = [(process.argv[2] ?? "npm") as "npm" | "pypi", process.argv[3] ?? "event-stream"];
console.log(`\nfull vet of ${eco}/${name}`);
const tiers: Record<string, { n: number; tokens: number; ms: number }> = {};
await vet(
  eco,
  name,
  (e) => {
    if (e.type === "stage" && e.status === "done") console.log(`  ${e.stage} done${e.note ? ` (${e.note})` : ""}`);
    if (e.type === "llm") {
      const t = (tiers[e.call.tier] ??= { n: 0, tokens: 0, ms: 0 });
      t.n++;
      t.tokens += (e.call.promptTokens ?? 0) + (e.call.completionTokens ?? 0);
      t.ms = Math.max(t.ms, e.call.ms);
      if (!e.call.ok) console.log(`  ${e.call.tier} ${e.call.stage}: ${e.call.error}`);
    }
    if (e.type === "verdict") console.log(`  verdict: ${e.verdict.verdict} (${e.verdict.confidence}) ${e.verdict.headline}`);
    if (e.type === "done") console.log(`  total ${(e.ms / 1000).toFixed(1)} s`);
  },
  { fresh: true },
);
console.log("per tier (calls, tokens, slowest call ms):", tiers);
