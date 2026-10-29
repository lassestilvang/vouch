// Captures real product screenshots for the pitch deck (public/pitch/img).
// Needs a running server with .env.local keys: node scripts/pitch-shots.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:3077";
const OUT = "public/pitch/img";
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
const p = await ctx.newPage();
const done = () => p.getByText("Recommendation:", { exact: true }).waitFor({ timeout: 120_000 });

await p.goto(`${BASE}/?e=npm&p=event-stream`, { waitUntil: "networkidle" });
await done();
// A cached replay shows 0.0s per stage; re-run live so the trace has real timings.
await p.getByRole("button", { name: "Re-run without cache" }).click();
await p.getByText("Re-run without cache").waitFor({ timeout: 180_000 });
await done();
await p.waitForTimeout(500);
await p.locator("main > div.grid > div > section").first().screenshot({ path: `${OUT}/verdict.png` });
await p.locator("aside section").first().screenshot({ path: `${OUT}/trace.png` });
await p.screenshot({ path: `${OUT}/app.png` });

await p.goto(`${BASE}/?e=pypi&p=reqeusts`, { waitUntil: "networkidle" });
await done();
await p.waitForTimeout(300);
await p.locator("main > div.grid > div > section").first().screenshot({ path: `${OUT}/missing.png` });

await p.goto(BASE, { waitUntil: "networkidle" });
await p.getByRole("tab", { name: "Scan a manifest" }).click();
await p.getByRole("button", { name: "package.json", exact: true }).click();
await p.getByText(/screening calls/).waitFor({ timeout: 60_000 });
await p.waitForTimeout(800);
await p.locator("section", { has: p.locator("table") }).screenshot({ path: `${OUT}/scan.png` });

await b.close();
console.log("shots saved to", OUT);
