// Smoke test against a running server: SMOKE_BASE=https://your-deploy bun scripts/smoke.ts
export {};
const base = process.env.SMOKE_BASE ?? "http://127.0.0.1:3077";

async function stream(path: string, body: unknown) {
  const res = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) return { status: res.status, events: [] as { type: string; [k: string]: unknown }[], error: await res.text() };
  const text = await res.text();
  return { status: res.status, events: text.trim().split("\n").map((l) => JSON.parse(l)) };
}

const failures: string[] = [];
const check = (ok: boolean, msg: string) => (ok ? console.log("ok  ", msg) : (failures.push(msg), console.log("FAIL", msg)));

const scan = await stream("/api/scan", { manifest: "requests>=2.31\nnumpy==2.1.0\nreqeusts==2.31.0\npython-dateutil\nflask\n-r dev.txt\n" });
const rows = scan.events.filter((e) => e.type === "row").map((e) => e.row as { name: string; ruleRisk: string; exists: boolean });
check(scan.status === 200 && rows.length === 5, `scan returned ${rows.length} rows`);
check(rows.find((r) => r.name === "reqeusts")?.ruleRisk === "high", "reqeusts flagged high");
check(rows.find((r) => r.name === "requests")?.ruleRisk === "low", "requests is low");
check(scan.events.some((e) => e.type === "screen"), "Nano screening results streamed");
check(scan.events.at(-1)?.type === "done", "scan ends with done");

const vet = await stream("/api/vet", { ecosystem: "pypi", name: "reqeusts" });
const v = vet.events.find((e) => e.type === "verdict") as { verdict: { verdict: string } } | undefined;
check(v?.verdict.verdict === "avoid", "nonexistent package -> avoid");

const bad = await stream("/api/vet", { ecosystem: "npm", name: "../../etc/passwd" });
check(bad.status === 400, "path-like name rejected");
const badEco = await stream("/api/vet", { ecosystem: "cargo", name: "serde" });
check(badEco.status === 400, "unknown ecosystem rejected");

if (failures.length) process.exit(1);
console.log("\nsmoke passed");
