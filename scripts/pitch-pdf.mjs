// Screenshots every slide of /pitch (after its reveal animation) and builds a PDF.
// node scripts/pitch-pdf.mjs  ->  .demo/pitch/slide-NN.png and .demo/vouch-pitch.pdf
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:3077";
const DIR = ".demo/pitch";
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await p.goto(`${BASE}/pitch#1`, { waitUntil: "networkidle" });
const total = Number((await p.locator("section[aria-label]").count()) || 0);
const files = [];
for (let k = 0; k < total; k++) {
  await p.waitForTimeout(2200); // let staggered reveals and bar animations finish
  const f = `${DIR}/slide-${String(k + 1).padStart(2, "0")}.png`;
  await p.screenshot({ path: f });
  files.push(f);
  await p.keyboard.press("ArrowRight");
}
await b.close();

// One PDF page per slide, via an image-only HTML page printed by Chromium.
const b2 = await chromium.launch();
const pdfPage = await b2.newPage();
const { readFileSync } = await import("node:fs");
const html = `<html><head><style>@page{size:1920px 1080px;margin:0}body{margin:0}img{display:block;width:1920px;height:1080px;page-break-after:always}</style></head><body>${files
  .map((f) => `<img src="data:image/png;base64,${readFileSync(f).toString("base64")}">`)
  .join("")}</body></html>`;
await pdfPage.setContent(html, { waitUntil: "load" });
await pdfPage.pdf({ path: ".demo/vouch-pitch.pdf", width: "1920px", height: "1080px", printBackground: true });
await b2.close();
console.log(`${files.length} slides -> .demo/vouch-pitch.pdf`);
execFileSync("ffmpeg", ["-v", "error", "-y", "-pattern_type", "glob", "-i", `${DIR}/slide-*.png`, "-vf", "scale=640:-1,tile=3x4", "-frames:v", "1", `${DIR}/contact.png`]);
console.log(`${DIR}/contact.png`);
