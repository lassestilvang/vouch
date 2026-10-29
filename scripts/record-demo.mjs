// Records the narrated demo video against a running Vouch server (real models, no mocks).
//
//   bun run build && bunx next start -H 127.0.0.1 -p 3077   # with .env.local keys
//   node scripts/record-demo.mjs                              # -> .demo/vouch-demo.mp4
//
// Narration uses macOS `say`; captions, title cards and the cursor are drawn in the page.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:3077";
const OUT = resolve(".demo");
const VOICE = process.env.DEMO_VOICE ?? "Samantha";
const RATE = process.env.DEMO_RATE ?? "178";
const W = 1600;
const H = 900;

const SEGMENTS = {
  intro:
    "Every npm install, and every pip install, runs a stranger's code on your machine. Attackers know it. Hijacked maintainers, typosquats, and now fake package names that AI assistants hallucinate. Vouch checks a package before you install it.",
  home: "Vouch is an agent built on NVIDIA Nemotron, served by Nebius Token Factory, with web research from Tavily. Let's check event-stream, a package that was hijacked in 2018.",
  facts:
    "Hard facts land first, with no model involved. An old advisory, an archived repo, and eight years without a release. Then Nemotron Super plans targeted searches, Tavily runs them, and Nemotron Nano triages every source in parallel, throwing out pages about other projects.",
  ultra: "Finally, Nemotron Ultra, with reasoning switched on, weighs the facts against the evidence.",
  verdict:
    "The verdict is avoid, with high confidence. Every risk is cited to an advisory or a web source you can open, and the alternatives are one click away.",
  trace:
    "The agent trace shows the model routing on Token Factory. Several fast Nano calls, one Super call, and a single Ultra call that does the real thinking. Most tokens go to the cheapest model.",
  reqeusts:
    "Now, something an AI assistant might suggest. Reqeusts, on PyPI. It doesn't exist. If someone registers that name tomorrow, it's malware. Vouch says so, and points to the real package.",
  scan: "You can also paste a whole package dot json. Vouch collects facts for every dependency, and Nano screens them all in a few seconds. The risky ones float to the top. A name that doesn't exist, a typosquat, and two abandoned packages.",
  deepdive: "Deep dive sends only the risky ones to Ultra. Lodahs is a typosquat of lodash, which npm already pulled as malware.",
  adopt: "And it isn't just paranoid. Requests has a long advisory history, but every issue is fixed in the latest version, so it gets adopt.",
  outro: "Vouch. Open source, under the MIT license. Know what you install.",
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "audio"), { recursive: true });

// 1. Narration audio, so the scenario knows how long each segment lasts.
//    ElevenLabs when ELEVENLABS_API_KEY is set, otherwise macOS `say`.
const XI = process.env.ELEVENLABS_API_KEY;
const XI_VOICE = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";
console.log(`narration voice: ${XI ? `ElevenLabs ${XI_VOICE}` : `macOS say (${VOICE})`}`);
const audio = {};
for (const [k, text] of Object.entries(SEGMENTS)) {
  let file;
  if (XI) {
    file = join(OUT, "audio", `${k}.mp3`);
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${XI_VOICE}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": XI, "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
    });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
    (await import("node:fs")).writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  } else {
    file = join(OUT, "audio", `${k}.aiff`);
    execFileSync("say", ["-v", VOICE, "-r", RATE, "-o", file, text]);
  }
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
  audio[k] = { file, ms: Math.round(dur * 1000) };
}
console.log("narration:", Object.fromEntries(Object.entries(audio).map(([k, v]) => [k, v.ms])));

// 2. Warm the server cache for the packages shown after the live run, so the video stays short.
async function warm(ecosystem, name) {
  const r = await fetch(`${BASE}/api/vet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ecosystem, name }) });
  const text = await r.text();
  if (!text.includes('"type":"verdict"')) throw new Error(`warm-up failed for ${name}`);
}
console.log("warming cache…");
await Promise.all([warm("npm", "lodahs"), warm("pypi", "requests")]);

// 3. Record.
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: OUT, size: { width: W, height: H } },
  colorScheme: "dark",
});
const page = await context.newPage();
const t0 = Date.now();
const timeline = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(BASE, { waitUntil: "networkidle" });
// A server started before the last build serves HTML that points at a missing stylesheet.
const styled = await page.evaluate(() => getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)");
if (!styled) throw new Error("app CSS did not load: restart `next start` after building");
await page.addStyleTag({
  content: `
  #demo-cap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:1180px;padding:12px 22px;border-radius:12px;
    background:rgba(0,0,0,.78);color:#fff;font:500 21px/1.4 var(--font-geist-sans),system-ui;text-align:center;z-index:9998;transition:opacity .3s;pointer-events:none}
  #demo-card{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:#0b0d10;z-index:9999;transition:opacity .6s;pointer-events:none}
  #demo-card h1{font:600 96px/1 var(--font-geist-sans),system-ui;color:#e7ecf2;letter-spacing:-.03em;margin:0}
  #demo-card h1 span{color:#76b900}
  #demo-card p{font:400 30px/1.3 var(--font-geist-sans),system-ui;color:#8b96a5;margin:0}
  #demo-card small{margin-top:28px;font:500 20px var(--font-geist-mono),monospace;color:#76b900}
  #demo-cursor{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,255,255,.9);
    box-shadow:0 0 0 4px rgba(118,185,0,.45);z-index:9997;pointer-events:none;transition:transform .7s cubic-bezier(.4,0,.2,1)}
  #demo-cursor.down{box-shadow:0 0 0 10px rgba(118,185,0,.35)}
  .demo-hl{outline:3px solid #76b900 !important;outline-offset:6px;border-radius:12px;transition:outline-color .3s}
`,
});
await page.evaluate(() => {
  for (const id of ["demo-cap", "demo-cursor"]) {
    const d = document.createElement("div");
    d.id = id;
    document.body.appendChild(d);
  }
  document.getElementById("demo-cap").style.opacity = "0";
  document.getElementById("demo-cursor").style.transform = "translate(800px,450px)";
});

async function card(title, sub, small) {
  await page.evaluate(
    ([t, s, m]) => {
      let c = document.getElementById("demo-card");
      if (!c) {
        c = document.createElement("div");
        c.id = "demo-card";
        document.body.appendChild(c);
      }
      c.innerHTML = `<h1>${t}</h1><p>${s}</p>${m ? `<small>${m}</small>` : ""}`;
      c.style.opacity = "1";
    },
    [title, sub, small],
  );
}
const hideCard = () => page.evaluate(() => (document.getElementById("demo-card").style.opacity = "0"));

/** Play one narration segment with its caption while `action` runs; resolves when both finish. */
async function say(key, action = async () => {}) {
  const a = audio[key];
  timeline.push({ file: a.file, at: Date.now() - t0 });
  await page.evaluate((t) => {
    const c = document.getElementById("demo-cap");
    c.textContent = t;
    c.style.opacity = "1";
  }, SEGMENTS[key]);
  await Promise.all([sleep(a.ms + 250), action()]);
  await page.evaluate(() => (document.getElementById("demo-cap").style.opacity = "0"));
  await sleep(200);
}

async function moveTo(locator) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  if (!b) return;
  await page.evaluate(([x, y]) => (document.getElementById("demo-cursor").style.transform = `translate(${x}px,${y}px)`), [b.x + b.width / 2, b.y + b.height / 2]);
  await sleep(750);
}
async function click(locator) {
  await moveTo(locator);
  await page.evaluate(() => document.getElementById("demo-cursor").classList.add("down"));
  await locator.click();
  await sleep(150);
  await page.evaluate(() => document.getElementById("demo-cursor").classList.remove("down"));
}
async function type(locator, text) {
  await click(locator);
  await locator.fill("");
  await locator.pressSequentially(text, { delay: 70 });
}
const scrollTo = (y) => page.evaluate((top) => window.scrollTo({ top, behavior: "smooth" }), y);
async function scrollToEl(locator, offset = 90) {
  const y = await locator.evaluate((el, off) => el.getBoundingClientRect().top + window.scrollY - off, offset);
  await scrollTo(y);
  await sleep(900);
}
async function highlight(locator, on = true) {
  await locator.evaluate((el, v) => el.classList.toggle("demo-hl", v), on);
}

const input = page.getByLabel("Package name");
const verdictDone = () => page.getByText("Recommendation:", { exact: true }).waitFor({ timeout: 120_000 });

// --- Scene: title
await card("Vouch<span>.</span>", "Should you trust this package?", "NVIDIA Nemotron · Nebius Token Factory · Tavily");
await sleep(600);
await say("intro");
await hideCard();
await sleep(700);

// --- Scene: event-stream, live
await say("home", async () => {
  await sleep(1200);
  await type(input, "event-stream");
});
await click(page.getByRole("button", { name: "Vet package" }));
await say("facts", async () => {
  await page.getByText("Facts and rule-based signals").waitFor({ timeout: 30_000 });
  await sleep(1500);
  await scrollToEl(page.getByText("Facts and rule-based signals"));
  await sleep(5500);
  await scrollTo(0);
});
await say("ultra");
await verdictDone();
await sleep(600);
await scrollTo(0);
await say("verdict", async () => {
  await sleep(2500);
  await scrollToEl(page.getByText("Risks", { exact: true }), 140);
  await sleep(3000);
  await scrollToEl(page.getByText("Recommendation:", { exact: true }), 260);
});
const trace = page.locator("section", { has: page.getByText("Agent trace", { exact: true }) });
await scrollToEl(trace, 40);
await highlight(trace);
await say("trace", async () => {
  await sleep(2500);
  await scrollToEl(page.getByText("Model routing", { exact: true }), 160);
});
await highlight(trace, false);
await scrollTo(0);
await sleep(600);

// --- Scene: reqeusts (does not exist)
await say("reqeusts", async () => {
  await sleep(1800);
  await click(page.getByRole("radio", { name: "PyPI" }));
  await type(input, "reqeusts");
  await click(page.getByRole("button", { name: "Vet package" }));
  await verdictDone();
  await sleep(300);
  const sig = page.getByText(/Did you mean "requests"/).first();
  await moveTo(sig);
});
await sleep(400);

// --- Scene: manifest scan
await scrollTo(0);
await click(page.getByRole("tab", { name: "Scan a manifest" }));
await say("scan", async () => {
  await sleep(1500);
  await click(page.getByRole("button", { name: "package.json", exact: true }));
  await page.getByText(/screening calls/).waitFor({ timeout: 60_000 });
  await sleep(800);
  await scrollToEl(page.locator("table"), 220);
});
await sleep(300);

// --- Scene: deep dive lodahs (cached)
await say("deepdive", async () => {
  await sleep(1500);
  await click(page.locator("tr", { hasText: "lodahs" }).getByRole("button", { name: "Deep dive" }));
  await verdictDone();
  await sleep(600);
  await scrollToEl(page.getByText("Risks", { exact: true }), 260);
});
await scrollTo(0);
await sleep(500);

// --- Scene: requests (cached) -> adopt
await say("adopt", async () => {
  await sleep(1200);
  await click(page.getByRole("radio", { name: "PyPI" }));
  await type(input, "requests");
  await click(page.getByRole("button", { name: "Vet package" }));
  await verdictDone();
  await sleep(300);
  await moveTo(page.getByText("Adopt", { exact: true }).first());
});
await sleep(800);

// --- Scene: outro
await card("Vouch<span>.</span>", "Know what you install.", "github.com/lassestilvang/vouch · MIT");
await sleep(700);
await say("outro");
await sleep(1500);

const videoPath = await page.video().path();
await context.close();
await browser.close();
const raw = join(OUT, "raw.webm");
renameSync(videoPath, raw);
console.log("timeline:", timeline.map((t) => `${(t.at / 1000).toFixed(1)}s ${t.file.split("/").pop()}`).join(", "));

// 4. Mix narration onto the video and encode for YouTube.
const args = ["-y", "-i", raw];
for (const t of timeline) args.push("-i", t.file);
const delays = timeline.map((t, i) => `[${i + 1}:a]adelay=${t.at}|${t.at},aresample=48000[a${i}]`).join(";");
const mix = `${delays};${timeline.map((_, i) => `[a${i}]`).join("")}amix=inputs=${timeline.length}:normalize=0,apad[aout]`;
const mp4 = join(OUT, "vouch-demo.mp4");
args.push(
  "-filter_complex", mix,
  "-map", "0:v", "-map", "[aout]",
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30",
  "-c:a", "aac", "-b:a", "192k", "-ac", "2",
  "-shortest", "-movflags", "+faststart", mp4,
);
execFileSync("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] });
for (const f of readdirSync(OUT)) if (f.endsWith(".webm") && f !== "raw.webm") rmSync(join(OUT, f));
console.log("MP4", mp4);
