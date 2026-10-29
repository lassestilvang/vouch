// Cinematic demo recorder: real app, real Nemotron calls, no mocks.
//
//   bun run build && node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3077
//   node --env-file=.env.local scripts/record-demo.mjs        # -> .demo/vouch-demo.mp4
//
// Frames come from Chromium's screencast at 1920x1080 device pixels (sharper than
// Playwright's built-in video), a CSS "camera" zooms into the part being narrated,
// and ffmpeg mixes the narration. ElevenLabs is used when ELEVENLABS_API_KEY is set,
// otherwise macOS `say`.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:3077";
const OUT = resolve(".demo");
const FRAMES = join(OUT, "frames");
const VOICE = process.env.DEMO_VOICE ?? "Samantha";
const RATE = process.env.DEMO_RATE ?? "182";
const VW = 1440;
const VH = 810;
const DSF = 1920 / VW;

const SEGMENTS = {
  hook1:
    "In 2018, a stranger took over event-stream, a package with two million weekly downloads, and shipped a crypto wallet stealer to everyone who installed it. It keeps happening. Hijacked accounts. Sabotage. Backdoors.",
  hook2: "And AI made it worse. About one in five package names suggested by coding models don't exist. Attackers register them. It's called slopsquatting.",
  intro: "This is Vouch. Name any npm or PyPI package, and an AI agent investigates it before it touches your machine.",
  run: "Let's check event-stream. Live. Hard facts come first, straight from the registries, with no model involved. Then Nemotron Super plans the research, Tavily searches the web, and Nemotron Nano triages every source in parallel.",
  ultra: "Finally, Nemotron Ultra reasons, once, over the distilled evidence.",
  // The live verdict can differ between runs; the matching line is chosen at record time.
  verdict_avoid: "Avoid. It found the 2018 compromise, the archived repo, and that the attacker is still a listed maintainer.",
  verdict_caution:
    "Caution, with low scores across the board. It found the 2018 compromise, the archived repo, and eight years without a single release.",
  verdict_adopt: "It weighed the 2018 compromise against today's code, and every risk it found is spelled out.",
  risks: "Every risk is cited, to a security advisory or a web source you can open.",
  trace:
    "Here's the routing on Nebius Token Factory. Several fast Nano calls, one Super call, and a single Ultra call that does the real thinking. Most of the tokens go to the cheapest model.",
  reqeusts: "Now the AI problem. Reqeusts, on PyPI. It doesn't exist. Vouch catches it instantly, before any model runs, and points you to the real package.",
  scan: "Or paste a whole package dot json. Nano screens every dependency in seconds. The malware, the fake name, and the abandoned packages float straight to the top.",
  adopt: "And it isn't just paranoid. Requests has a long advisory history, but every issue is fixed in the latest version. Adopt.",
  learned:
    "One thing we learned building it. Nemotron reasons by default, and our first live run returned nothing. Switching reasoning off for the fast tiers made them three times faster, with five times fewer tokens. Ultra keeps thinking, where it matters.",
  close: "Vouch. Open source, and live today. Know what you install.",
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "audio"), { recursive: true });
mkdirSync(FRAMES, { recursive: true });

/* ---------- 1. narration ---------- */
const XI = process.env.ELEVENLABS_API_KEY;
const XI_VOICE = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";
console.log(`voice: ${XI ? `ElevenLabs ${XI_VOICE}` : `macOS say ${VOICE}`}`);
const audio = {};
for (const [k, text] of Object.entries(SEGMENTS)) {
  let file;
  if (XI) {
    file = join(OUT, "audio", `${k}.mp3`);
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${XI_VOICE}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": XI, "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2 } }),
    });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  } else {
    file = join(OUT, "audio", `${k}.aiff`);
    execFileSync("say", ["-v", VOICE, "-r", RATE, "-o", file, text]);
  }
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
  audio[k] = { file, ms: Math.round(dur * 1000) };
}
const totalNarration = Object.values(audio).reduce((a, x) => a + x.ms, 0);
console.log(`narration ${(totalNarration / 1000).toFixed(1)}s`);

/* ---------- 2. warm cache for the quick follow-up checks ---------- */
async function warm(ecosystem, name) {
  const r = await fetch(`${BASE}/api/vet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ecosystem, name }) });
  if (!(await r.text()).includes('"type":"verdict"')) throw new Error(`warm-up failed for ${name}`);
}
await warm("pypi", "requests");

/* ---------- 3. record ---------- */
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF, colorScheme: "dark" });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const frames = [];
let frameNo = 0;
cdp.on("Page.screencastFrame", async (f) => {
  const file = join(FRAMES, `${String(frameNo++).padStart(6, "0")}.jpg`);
  writeFileSync(file, Buffer.from(f.data, "base64"));
  frames.push({ file, ts: f.metadata.timestamp });
  await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
const startCast = () =>
  cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timeline = [];

const OVERLAY_CSS = `
  html.demo, html.demo body { overflow: hidden !important; }
  #d-cap{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);max-width:1040px;width:max-content;padding:12px 22px;border-radius:14px;
    background:rgba(5,7,9,.82);border:1px solid rgba(255,255,255,.08);backdrop-filter:blur(10px);color:#fff;
    font:500 20px/1.45 var(--font-geist-sans),system-ui;text-align:center;z-index:2147483646;opacity:0;transition:opacity .35s;pointer-events:none}
  #d-chap{position:fixed;left:28px;top:22px;z-index:2147483646;opacity:0;transition:opacity .4s, transform .4s;transform:translateY(-6px);pointer-events:none;
    font:600 12px/1 var(--font-geist-mono),monospace;letter-spacing:.18em;text-transform:uppercase;color:#76b900;
    background:rgba(5,7,9,.8);border:1px solid rgba(118,185,0,.35);padding:9px 12px;border-radius:10px}
  #d-chap.on{opacity:1;transform:none}
  #d-cur{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,255,255,.92);
    box-shadow:0 0 0 5px rgba(118,185,0,.4),0 6px 20px rgba(0,0,0,.6);z-index:2147483647;pointer-events:none;
    transition:transform .75s cubic-bezier(.4,0,.2,1), box-shadow .2s}
  #d-cur.down{box-shadow:0 0 0 12px rgba(118,185,0,.3),0 6px 20px rgba(0,0,0,.6)}
  #d-cur.hide{opacity:0}
`;

async function inject({ app = false, cursor = true } = {}) {
  await page.addStyleTag({ content: OVERLAY_CSS });
  await page.evaluate(
    ([app, cursor]) => {
      // Overlays live on <html>, outside <body>, so the camera transform on <body> doesn't move them.
      for (const id of ["d-cap", "d-chap", "d-cur"]) {
        if (document.getElementById(id)) continue;
        const d = document.createElement("div");
        d.id = id;
        document.documentElement.appendChild(d);
      }
      const cur = document.getElementById("d-cur");
      cur.style.transform = "translate(720px,520px)";
      cur.classList.toggle("hide", !cursor);
      if (app) {
        document.documentElement.classList.add("demo");
        window.scrollTo(0, 0);
        const b = document.body;
        b.style.transformOrigin = "0 0";
        b.style.willChange = "transform";
        window.__cam = { tx: 0, ty: 0, s: 1 };
        window.__camTo = (sel, s, mode, dur) => {
          b.style.transition = `transform ${dur}ms cubic-bezier(.65,0,.35,1)`;
          if (!sel) {
            window.__cam = { tx: 0, ty: 0, s: 1 };
            b.style.transform = "translate(0px,0px) scale(1)";
            return;
          }
          const el = document.querySelector(sel);
          if (!el) return;
          const r = el.getBoundingClientRect();
          const c = window.__cam;
          const x = (r.left - c.tx) / c.s;
          const y = (r.top - c.ty) / c.s;
          const w = r.width / c.s;
          const h = r.height / c.s;
          const vw = innerWidth;
          const vh = innerHeight;
          const bw = b.offsetWidth;
          const bh = b.scrollHeight;
          let tx = vw / 2 - (x + w / 2) * s;
          let ty = mode === "top" ? 74 - y * s : vh / 2 - (y + h / 2) * s;
          tx = Math.min(0, Math.max(vw - bw * s, tx));
          ty = Math.min(0, Math.max(Math.min(0, vh - bh * s), ty));
          window.__cam = { tx, ty, s };
          b.style.transform = `translate(${tx}px,${ty}px) scale(${s})`;
        };
      }
    },
    [app, cursor],
  );
}

async function cam(sel, s = 1.3, mode = "center", dur = 1300) {
  await page.evaluate(([sel, s, mode, dur]) => window.__camTo?.(sel, s, mode, dur), [sel, s, mode, dur]);
  await sleep(dur + 100);
}

async function chapter(text) {
  await page.evaluate((t) => {
    const c = document.getElementById("d-chap");
    if (!c) return;
    c.classList.remove("on");
    if (t) {
      c.textContent = t;
      requestAnimationFrame(() => c.classList.add("on"));
    }
  }, text);
}

/** Play one narration segment with its caption while `action` runs; resolves when both finish. */
async function say(key, action = async () => {}, { caption = true } = {}) {
  const a = audio[key];
  timeline.push({ file: a.file, at: Date.now() / 1000 });
  if (caption)
    await page.evaluate((t) => {
      const c = document.getElementById("d-cap");
      c.textContent = t;
      c.style.opacity = "1";
    }, SEGMENTS[key]);
  await Promise.all([sleep(a.ms + 250), action()]);
  await page.evaluate(() => {
    const c = document.getElementById("d-cap");
    if (c) c.style.opacity = "0";
  });
  await sleep(250);
}

async function moveTo(locator) {
  const b = await locator.boundingBox();
  if (!b) return;
  await page.evaluate(([x, y]) => (document.getElementById("d-cur").style.transform = `translate(${x}px,${y}px)`), [b.x + b.width / 2, b.y + b.height / 2]);
  await sleep(800);
}
async function click(locator) {
  await moveTo(locator);
  await page.evaluate(() => document.getElementById("d-cur").classList.add("down"));
  await locator.click();
  await sleep(180);
  await page.evaluate(() => document.getElementById("d-cur").classList.remove("down"));
}
async function type(locator, text) {
  await click(locator);
  await locator.fill("");
  await locator.pressSequentially(text, { delay: 75 });
}
/** Wait until the verdict card shows a finished verdict for this exact package, not the previous one. */
const verdictFor = (name) =>
  page.waitForFunction(
    (n) => {
      const title = document.querySelector('[data-demo="verdict"] .font-mono')?.textContent ?? "";
      return title === n || title.startsWith(n + "@");
    },
    name,
    { timeout: 150_000, polling: 200 },
  );

async function gotoDeck(n) {
  await page.goto(`${BASE}/pitch?s=${n}-${Date.now()}#${n}`, { waitUntil: "networkidle" });
  await inject({ cursor: false });
}
async function gotoApp() {
  await page.goto(BASE, { waitUntil: "networkidle" });
  const styled = await page.evaluate(() => getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)");
  if (!styled) throw new Error("app CSS did not load: restart the server after building");
  await inject({ app: true });
}

// Load before starting the screencast so the video opens on a finished frame.
await page.goto(`${BASE}/pitch?s=warm#3`, { waitUntil: "networkidle" });
await page.goto(`${BASE}/pitch?s=open#2`, { waitUntil: "networkidle" });
await inject({ cursor: false });
await sleep(1800);
await startCast();
const t0 = Date.now() / 1000;

// --- Hook: the problem (deck slides 2 and 3, animated)
await say("hook1");
await page.keyboard.press("ArrowRight");
await sleep(300);
await say("hook2");

// --- Meet Vouch
await gotoApp();
await cam("main h1", 1.45, "center", 10);
await sleep(300);
await say("intro", async () => {
  await sleep(600);
  await cam("main form", 1.25, "center", 1800);
});

// --- Live investigation of event-stream
const input = page.getByLabel("Package name");
await chapter("Live · npm event-stream");
await say("run", async () => {
  await type(input, "event-stream");
  await click(page.getByRole("button", { name: "Vet package" }));
  await sleep(500);
  await cam('[data-demo="pipeline"]', 1.25, "top", 1400);
  await page.locator('[data-demo="pipeline"]').getByText("Triage sources").waitFor();
});
await say("ultra", async () => {
  await sleep(300);
});
await verdictFor("event-stream");
await sleep(500);
const live = ((await page.locator('[data-demo="verdict"] .text-3xl').first().textContent()) ?? "avoid").trim().toLowerCase();
const verdictKey = live.startsWith("adopt") ? "verdict_adopt" : live.startsWith("caution") ? "verdict_caution" : "verdict_avoid";
console.log("event-stream verdict:", live);
await chapter("Cited verdict · Nemotron Ultra");
await cam('[data-demo="verdict"]', 1.45, "top", 1300);
await say(verdictKey, async () => {
  await sleep(1200);
  await moveTo(page.locator('[data-demo="verdict"] .gauge-arc').first());
});
await cam('[data-demo="risks"]', 1.4, "top", 1300);
await say("risks", async () => {
  await sleep(900);
  const cite = page.locator('[data-demo="risks"] a').first();
  if (await cite.count()) await moveTo(cite);
});
await chapter("Model routing · Nebius Token Factory");
await cam('[data-demo="trace"]', 1.55, "top", 1400);
await say("trace");

// --- The AI problem: a hallucinated name
await chapter("Slopsquatting · PyPI reqeusts");
await cam(null, 1, "center", 1100);
await say("reqeusts", async () => {
  await click(page.getByRole("radio", { name: "PyPI" }));
  await type(input, "reqeusts");
  await click(page.getByRole("button", { name: "Vet package" }));
  await verdictFor("reqeusts");
  await sleep(300);
  await cam('[data-demo="verdict"]', 1.45, "top", 1300);
});

// --- Whole manifest
await chapter("Scan a package.json · Nemotron Nano");
await cam(null, 1, "center", 900);
await click(page.getByRole("tab", { name: "Scan a manifest" }));
await sleep(400);
await say("scan", async () => {
  await click(page.getByRole("button", { name: "package.json", exact: true }));
  await page.locator('[data-demo="scan"]').waitFor();
  await cam('[data-demo="scan"]', 1.15, "top", 1300);
  await page.getByText(/screening calls/).waitFor({ timeout: 60_000 });
});

// --- Calibration: a healthy package
await chapter("Calibrated · PyPI requests");
await cam(null, 1, "center", 900);
await click(page.getByRole("tab", { name: "One package" }));
await sleep(300);
await say("adopt", async () => {
  await click(page.getByRole("radio", { name: "PyPI" }));
  await type(input, "requests");
  await click(page.getByRole("button", { name: "Vet package" }));
  await verdictFor("requests");
  await sleep(200);
  await cam('[data-demo="verdict"]', 1.45, "top", 1200);
});
await chapter(null);
await sleep(500);

// --- What we learned, then close (deck)
await gotoDeck(7);
await say("learned");
await gotoDeck(12);
await sleep(300);
await say("close");
await sleep(2200);

await cdp.send("Page.stopScreencast");
await sleep(300);
await browser.close();

/* ---------- 4. assemble ---------- */
frames.sort((a, b) => a.ts - b.ts);
const start = Math.max(t0, frames[0].ts);
const usable = frames.filter((f) => f.ts >= start - 0.5);
let list = "";
for (let i = 0; i < usable.length; i++) {
  const d = i + 1 < usable.length ? Math.max(0.001, usable[i + 1].ts - usable[i].ts) : 1.5;
  list += `file '${usable[i].file}'\nduration ${d.toFixed(4)}\n`;
}
list += `file '${usable.at(-1).file}'\n`;
writeFileSync(join(OUT, "frames.txt"), list);
const video = join(OUT, "video.mp4");
execFileSync(
  "ffmpeg",
  ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", join(OUT, "frames.txt"), "-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", video],
  { stdio: "inherit" },
);
const vstart = usable[0].ts;
const args = ["-y", "-v", "error", "-i", video];
for (const t of timeline) args.push("-i", t.file);
const delays = timeline.map((t, i) => {
  const ms = Math.max(0, Math.round((t.at - vstart) * 1000));
  return `[${i + 1}:a]adelay=${ms}|${ms},aresample=48000[a${i}]`;
});
const mix = `${delays.join(";")};${timeline.map((_, i) => `[a${i}]`).join("")}amix=inputs=${timeline.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,apad[aout]`;
const mp4 = join(OUT, "vouch-demo.mp4");
args.push("-filter_complex", mix, "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-shortest", "-movflags", "+faststart", mp4);
execFileSync("ffmpeg", args, { stdio: "inherit" });
rmSync(FRAMES, { recursive: true, force: true });
rmSync(video);
console.log(`frames ${usable.length}`);
console.log("MP4", mp4);
