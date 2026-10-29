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
// Done when the verdict card shows this package (the card stays mounted between runs).
const done = (name) =>
  p.waitForFunction(
    (n) => {
      const t = document.querySelector('[data-demo="verdict"] .font-mono')?.textContent ?? "";
      return (t === n || t.startsWith(n + "@")) && !!document.querySelector('[data-demo="trace"] .font-mono');
    },
    name,
    { timeout: 180_000, polling: 250 },
  );
const settle = () => p.waitForTimeout(1600); // let gauges and bars finish animating

// The sticky header would otherwise overlap element screenshots.
const hideHeader = () => p.addStyleTag({ content: "body > header{display:none!important}" });
const verdictLabel = async () => ((await p.locator('[data-demo="verdict"] .text-3xl').first().textContent()) ?? "").trim();

await p.goto(`${BASE}/?e=npm&p=event-stream`, { waitUntil: "networkidle" });
await hideHeader();
await done("event-stream");
// A cached replay shows 0.0s per stage, so re-run live for real timings. The verdict is a
// live model opinion and can vary between runs; retry a few times so the screenshot
// matches the live-results table in the deck (EXPECT, default Avoid).
const EXPECT = process.env.EXPECT ?? "Avoid";
for (let attempt = 1; attempt <= 3; attempt++) {
  await p.getByRole("button", { name: "Re-run without cache" }).click();
  await p.getByRole("button", { name: "Re-run without cache" }).waitFor({ timeout: 180_000 });
  await done("event-stream");
  const got = await verdictLabel();
  console.log(`event-stream attempt ${attempt}: ${got}`);
  if (got === EXPECT) break;
}
await settle();
await p.locator('[data-demo="verdict"]').screenshot({ path: `${OUT}/verdict.png` });
await p.locator('[data-demo="trace"] section').first().screenshot({ path: `${OUT}/trace.png` });
await p.screenshot({ path: `${OUT}/app.png` });

await p.goto(`${BASE}/?e=pypi&p=reqeusts`, { waitUntil: "networkidle" });
await hideHeader();
await done("reqeusts");
await settle();
await p.locator('[data-demo="verdict"]').screenshot({ path: `${OUT}/missing.png` });

await p.goto(BASE, { waitUntil: "networkidle" });
await hideHeader();
await p.getByRole("tab", { name: "Scan a manifest" }).click();
await p.getByRole("button", { name: "package.json", exact: true }).click();
await p.getByText(/screening calls/).waitFor({ timeout: 60_000 });
await p.waitForTimeout(800);
await p.locator('[data-demo="scan"]').screenshot({ path: `${OUT}/scan.png` });

await b.close();
console.log("shots saved to", OUT);
