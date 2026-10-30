// Cinematic demo recorder: real CLI, real app, real Nemotron calls, no mocks.
//
//   bun run build && node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3077   # fresh server = empty cache
//   node --env-file=.env.local scripts/record-demo.mjs
//   -> .demo/vouch-demo.mp4 and .demo/vouch-demo.srt (upload the .srt to YouTube as captions)
//
// Frames come from Chromium's screencast at 1920x1080 device pixels, a CSS "camera" zooms into
// what's being narrated, and ffmpeg mixes narration, a quiet ducked pad and impact hits.
// Voice: ElevenLabs when ELEVENLABS_API_KEY is set, otherwise Microsoft neural TTS (msedge-tts).
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { chromium } from "playwright";

const BASE = process.env.DEMO_BASE ?? "http://127.0.0.1:3077";
const PUBLIC_URL = "https://vouch-phi-one.vercel.app";
const OUT = resolve(".demo");
const FRAMES = join(OUT, "frames");
const EDGE_VOICE = process.env.DEMO_VOICE ?? "en-US-AndrewMultilingualNeural";
const VW = 1440;
const VH = 810;
const DSF = 1920 / VW;

const SEGMENTS = {
  cold: "Your AI coding assistant just suggested a package: reqeusts. It doesn't exist. If an attacker registers that name tomorrow, this install runs their code. Vouch blocked it in under half a second, before a single model ran.",
  title: "This is Vouch. It checks every package before you install it.",
  hook: "Because every install runs a stranger's code, on your laptop, in your CI, next to your secrets. In 2018, a stranger took over event-stream, a package millions of projects depended on, and shipped a crypto wallet stealer to all of them.",
  hook2: "And AI made it worse. Nearly one in five package names that coding models suggest don't exist. Attackers register them, and wait. Your assistant is writing the bait.",
  cli2: "So what about a real package? Event-stream. An agent investigates it, live. Hard facts from the registries. Nemotron Super plans the research. Tavily searches the web. Nemotron Nano triages every source in parallel. And Nemotron Ultra reasons, once, to a verdict.",
  cli_avoid: "Avoid. Install blocked.",
  cli_caution: "Caution. Vouch won't install it without your OK.",
  cli_adopt: "Adopt. Install allowed.",
  web: "Here's that same investigation in the web app, replayed at speed. Facts land first, then each model takes its turn.",
  v_avoid: "Avoid, with high confidence. The 2018 compromise. An archived repo. And the attacker is still a listed maintainer.",
  v_caution: "Caution, with low scores across the board. The 2018 compromise, an archived repo, and eight years without a single release.",
  v_adopt: "It weighed the 2018 compromise against today's code, and spelled out every remaining risk.",
  risks: "Every risk is cited, to a security advisory or a source you can open.",
  trace: "This is the routing on Nebius Token Factory. Several fast Nano calls, one Super call, and a single Ultra call that does the real thinking.",
  learned:
    "One catch: Nemotron reasons by default, and our first live run returned nothing. Switching reasoning off for Nano and Super made them three times faster, with five times fewer tokens. Ultra keeps thinking, where it matters.",
  scan: "Scale it up. Paste a whole package dot json. Nano screens every dependency in seconds, and the malware, the fake name, and the abandoned libraries float straight to the top.",
  adopt: "And it isn't just paranoid. Requests has years of advisories, all fixed in the latest version. Adopt.",
  close: "Put Vouch in front of npm, pip, your CI, or your coding agent. Your next install is a stranger's code. Vouch tells you whose. Open source, and live today.",
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "audio"), { recursive: true });
mkdirSync(FRAMES, { recursive: true });
const probe = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

/* ---------- 1. narration ---------- */
const XI = process.env.ELEVENLABS_API_KEY;
const XI_VOICE = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";
console.log(`voice: ${XI ? `ElevenLabs ${XI_VOICE}` : `Microsoft neural ${EDGE_VOICE}`}`);
const audio = {};
for (const [k, text] of Object.entries(SEGMENTS)) {
  const file = join(OUT, "audio", `${k}.mp3`);
  if (XI) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${XI_VOICE}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": XI, "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.25 } }),
    });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  } else {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(EDGE_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const dir = join(OUT, "audio", `${k}.d`);
    mkdirSync(dir, { recursive: true });
    const { audioFilePath } = await tts.toFile(dir, text, { rate: "+6%" });
    renameSync(audioFilePath, file);
    rmSync(dir, { recursive: true, force: true });
    tts.close();
  }
  audio[k] = { file, ms: Math.round(probe(file) * 1000) };
}

/* ---------- 2. warm the cache for the calibration scene ---------- */
const warm = await fetch(`${BASE}/api/vet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ecosystem: "pypi", name: "requests" }) });
if (!(await warm.text()).includes('"type":"verdict"')) throw new Error("warm-up failed for requests");

/* ---------- 3. browser + screencast ---------- */
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timeline = []; // narration: { key, file, at, ms }
const hits = []; // impact sounds: { at }
const now = () => Date.now() / 1000;

const OVERLAY_CSS = `
  html.demo, html.demo body { overflow: hidden !important; }
  #d-chap{position:fixed;left:28px;top:22px;z-index:2147483646;opacity:0;transition:opacity .4s, transform .4s;transform:translateY(-6px);pointer-events:none;
    font:600 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.18em;text-transform:uppercase;color:#76b900;
    background:rgba(5,7,9,.85);border:1px solid rgba(118,185,0,.35);padding:9px 12px;border-radius:10px}
  #d-chap.on{opacity:1;transform:none}
  #d-call{position:fixed;left:50%;bottom:40px;transform:translate(-50%,10px);z-index:2147483646;opacity:0;transition:opacity .35s, transform .35s;pointer-events:none;
    font:700 30px/1.1 var(--font-geist-sans),system-ui;letter-spacing:-.02em;color:#fff;background:rgba(5,7,9,.88);border:1px solid rgba(255,255,255,.12);
    padding:14px 24px;border-radius:16px;white-space:nowrap;box-shadow:0 20px 60px -20px rgba(0,0,0,.8)}
  #d-call.on{opacity:1;transform:translate(-50%,0)}
  #d-call b{color:#76b900}
  #d-cap{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);max-width:1100px;width:max-content;padding:7px 14px;border-radius:9px;
    background:rgba(0,0,0,.72);color:#fff;font:500 17px/1.35 var(--font-geist-sans,-apple-system),system-ui,-apple-system,"Helvetica Neue",sans-serif;text-align:center;z-index:2147483645;opacity:0;transition:opacity .2s;pointer-events:none}
  #d-cap.on{opacity:1}
  #d-cur{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,255,255,.92);
    box-shadow:0 0 0 5px rgba(118,185,0,.4),0 6px 20px rgba(0,0,0,.6);z-index:2147483647;pointer-events:none;
    transition:transform .75s cubic-bezier(.4,0,.2,1), box-shadow .2s, opacity .3s}
  #d-cur.down{box-shadow:0 0 0 12px rgba(118,185,0,.3),0 6px 20px rgba(0,0,0,.6)}
  #d-cur.hide{opacity:0}
`;

async function inject({ app = false, cursor = true } = {}) {
  await page.addStyleTag({ content: OVERLAY_CSS });
  await page.evaluate(
    ([app, cursor]) => {
      // Overlays live on <html>, outside <body>, so the camera transform on <body> doesn't move them.
      for (const id of ["d-cap", "d-chap", "d-call", "d-cur"]) {
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
          const bw = b.offsetWidth;
          const bh = b.scrollHeight;
          let tx = innerWidth / 2 - (x + w / 2) * s;
          let ty = mode === "top" ? 74 - y * s : innerHeight / 2 - (y + h / 2) * s;
          tx = Math.min(0, Math.max(innerWidth - bw * s, tx));
          ty = Math.min(0, Math.max(Math.min(0, innerHeight - bh * s), ty));
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
const chapter = (t) =>
  page.evaluate((t) => {
    const c = document.getElementById("d-chap");
    if (!c) return;
    c.classList.remove("on");
    if (t) {
      c.textContent = t;
      requestAnimationFrame(() => c.classList.add("on"));
    }
  }, t);
const callout = (html) =>
  page.evaluate((h) => {
    const c = document.getElementById("d-call");
    if (!c) return;
    if (!h) return c.classList.remove("on");
    c.innerHTML = h;
    c.classList.add("on");
  }, html);
const hit = () => hits.push({ at: now() });
/** Slow zoom of the whole page (deck slides), centred. */
const kenBurns = (s, ms) =>
  page.evaluate(([s, ms]) => {
    const b = document.body;
    b.style.transformOrigin = "50% 45%";
    b.style.transition = `transform ${ms}ms linear`;
    b.style.transform = `scale(${s})`;
  }, [s, ms]);

const chunksOf = (text) =>
  text
    .match(/[^.!?:]+[.!?:]+["']?|\S[^.!?:]*$/g)
    .map((x) => x.trim())
    .filter(Boolean);

/** Play one narration segment while `action` runs; small sentence captions follow the voice. */
async function say(key, action = async () => {}) {
  const a = audio[key];
  timeline.push({ key, file: a.file, at: now(), ms: a.ms });
  const chunks = chunksOf(SEGMENTS[key]);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const captions = (async () => {
    for (const c of chunks) {
      await page
        .evaluate((t) => {
          const e = document.getElementById("d-cap");
          if (e) {
            e.textContent = t;
            e.classList.add("on");
          }
        }, c)
        .catch(() => {});
      await sleep(a.ms * (c.length / total));
    }
    await page.evaluate(() => document.getElementById("d-cap")?.classList.remove("on")).catch(() => {});
  })();
  await Promise.all([sleep(a.ms + 200), action(), captions]);
  await sleep(120);
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
/** Wait until the verdict card shows a finished verdict for this exact package. */
const verdictFor = (name) =>
  page.waitForFunction(
    (n) => {
      const t = document.querySelector('[data-demo="verdict"] .font-mono')?.textContent ?? "";
      return t === n || t.startsWith(n + "@");
    },
    name,
    { timeout: 150_000, polling: 200 },
  );

async function gotoDeck(n) {
  await page.goto(`${BASE}/pitch?s=${n}-${Date.now()}#${n}`, { waitUntil: "networkidle" });
  await inject({ cursor: false });
}
async function gotoApp(path = "/") {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  const styled = await page.evaluate(() => getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)");
  if (!styled) throw new Error("app CSS did not load: restart the server after building");
  await inject({ app: true });
}

/* ---------- terminal scene: the real CLI, streamed live into a terminal window ---------- */
const TERMINAL_HTML = `<!doctype html><html><head><style>
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:ui-monospace,"SF Mono",Menlo,monospace;
    background:radial-gradient(60rem 36rem at 50% -10rem,rgba(118,185,0,.18),transparent 70%),#0b0d10;color:#e7ecf2}
  .win{width:1340px;height:730px;border-radius:16px;background:#0e1116;border:1px solid rgba(255,255,255,.09);box-shadow:0 40px 120px -30px rgba(0,0,0,.9);overflow:hidden;display:flex;flex-direction:column}
  .bar{height:40px;display:flex;align-items:center;gap:8px;padding:0 16px;background:#151a21;border-bottom:1px solid rgba(255,255,255,.06);color:#8b96a5;font-size:13px}
  .dot{width:12px;height:12px;border-radius:50%}
  .title{flex:1;text-align:center;margin-right:52px}
  pre{margin:0;padding:24px 30px;font:21px/1.5 ui-monospace,"SF Mono",Menlo,monospace;white-space:pre-wrap;flex:1;overflow:hidden}
  .b{font-weight:700}.d{opacity:.55}.r{color:#ff6b6b}.g{color:#3fb950}.y{color:#e3b341}.c{color:#56d4dd}.m{color:#c4a5ff}.bl{color:#6cb6ff}.l{color:#a6e22e}
  .badge-r{background:#f85149;color:#fff;font-weight:800;padding:0 6px;border-radius:4px}
  .badge-y{background:#d29922;color:#111;font-weight:800;padding:0 6px;border-radius:4px}
  .badge-g{background:#3fb950;color:#111;font-weight:800;padding:0 6px;border-radius:4px}
  .p{color:#76b900}.caret{display:inline-block;width:10px;height:20px;background:#e7ecf2;vertical-align:-3px;animation:b 1s steps(1) infinite}
  @keyframes b{50%{opacity:0}}
</style></head><body><div class="win"><div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="title">~/my-app — zsh</span></div><pre id="t"></pre></div>
<script>
  const t = document.getElementById("t");
  const MAP = {"1":"b","2":"d","31":"r","32":"g","33":"y","34":"bl","35":"m","36":"c","92":"l"};
  const esc = s => s.replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
  let caret = '<span class="caret"></span>';
  let html = "";
  function render(){ t.innerHTML = html + caret; }
  window.ansi = (s) => {
    let out = "", open = 0;
    for (const part of s.split(/(\\x1b\\[[0-9;]*m)/)) {
      const m = part.match(/^\\x1b\\[([0-9;]*)m$/);
      if (!m) { out += esc(part); continue; }
      const codes = m[1].split(";");
      if (codes[0] === "0" || codes[0] === "") { out += "</span>".repeat(open); open = 0; continue; }
      let cls = codes.includes("41") ? "badge-r" : codes.includes("43") ? "badge-y" : codes.includes("42") ? "badge-g" : codes.map(c => MAP[c]).filter(Boolean).join(" ");
      out += '<span class="' + cls + '">'; open++;
    }
    return out + "</span>".repeat(open);
  };
  window.write = (s) => { html += window.ansi(s); render(); };
  window.prompt = () => { html += '<span class="p">❯</span> '; render(); };
  window.typeChar = (c) => { html += esc(c); render(); };
  window.hideCaret = () => { caret = ""; render(); };
  window.showCaret = () => { caret = '<span class="caret"></span>'; render(); };
  window.clearT = () => { html = ""; render(); };
  render();
</script></body></html>`;

async function runCli(display, args) {
  await page.evaluate(() => window.prompt());
  for (const ch of display) {
    await page.evaluate((c) => window.typeChar(c), ch);
    await sleep(45 + Math.random() * 40);
  }
  await sleep(350);
  await page.evaluate(() => {
    window.hideCaret();
    window.write("\n");
  });
  const child = spawn("node", ["bin/vouch.mjs", "--dry-run", ...args], {
    env: { ...process.env, FORCE_COLOR: "1", VOUCH_API: BASE, VOUCH_LINK: PUBLIC_URL },
  });
  let all = "";
  child.stdout.on("data", (d) => {
    const s = d.toString();
    all += s;
    page.evaluate((x) => window.write(x), s).catch(() => {});
  });
  await new Promise((r) => child.on("exit", r));
  await sleep(150);
  await page.evaluate(() => window.showCaret());
  return all;
}

/* ---------- 4. the film ---------- */
// Deck slides build item by item; slow the stagger so items land with the narration.
const slowDeck = () => page.evaluate(() => document.documentElement.style.setProperty("--deck-stagger", "750ms"));
// Warm the deck route so later navigations are instant.
await page.goto(`${BASE}/pitch?s=warm#3`, { waitUntil: "networkidle" });

// Cold open: an AI-suggested install, blocked at the keyboard
await page.setContent(TERMINAL_HTML);
await inject({ cursor: false });
await page.evaluate(() => window.write('\x1b[2m# AI assistant: "To call the API, first install the reqeusts library."\x1b[0m\n'));
await sleep(1200);
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
const t0 = now();
let reqOut = "";
await say("cold", async () => {
  await sleep(2400);
  reqOut = await runCli("vouch pip install reqeusts", ["pip", "install", "reqeusts"]);
  hit();
  await callout("Blocked in 0.4 s · <b>0 model calls</b>");
});
await sleep(400);
await callout(null);

// Title card
await gotoDeck(1);
hit();
await kenBurns(1.05, 6000);
await say("title");

// The problem, built item by item with the voice
await page.goto(`${BASE}/pitch?s=p-${Date.now()}#1`, { waitUntil: "networkidle" });
await inject({ cursor: false });
await slowDeck();
await page.keyboard.press("ArrowRight");
await kenBurns(1.06, 17000);
await say("hook");
await kenBurns(1, 10);
await page.keyboard.press("ArrowRight");
await sleep(200);
await kenBurns(1.06, 13000);
await say("hook2");

// A real package, investigated live in the terminal
await page.setContent(TERMINAL_HTML);
await inject({ cursor: false });
let esOut = "";
const cliRun = (async () => {
  await sleep(1500);
  esOut = await runCli("vouch npm install event-stream", ["npm", "install", "event-stream"]);
})();
await say("cli2", () => sleep(0));
await cliRun;
const cliVerdict = /AVOID/.test(esOut) ? "avoid" : /CAUTION/.test(esOut) ? "caution" : "adopt";
console.log("CLI event-stream verdict:", cliVerdict, "| reqeusts blocked:", /blocked/i.test(reqOut));
hit();
await say(`cli_${cliVerdict}`);
await sleep(700);

// Same investigation in the web app (replayed from the cache the CLI just filled)
await gotoApp("/");
await cam("main form", 1.25, "center", 10);
await chapter("Web app · npm event-stream");
const input = page.getByLabel("Package name");
await say("web", async () => {
  await type(input, "event-stream");
  await click(page.getByRole("button", { name: "Vet package" }));
  await sleep(300);
  await cam('[data-demo="pipeline"]', 1.25, "top", 1000);
  await verdictFor("event-stream");
});
await sleep(300);
const live = ((await page.locator('[data-demo="verdict"] .text-3xl').first().textContent()) ?? "avoid").trim().toLowerCase();
const vKey = live.startsWith("adopt") ? "v_adopt" : live.startsWith("caution") ? "v_caution" : "v_avoid";
await chapter("Cited verdict · Nemotron Ultra");
await cam('[data-demo="verdict"]', 1.5, "top", 1300);
hit();
await sleep(1200); // clean hold on the verdict, no voice
await say(vKey);
await cam('[data-demo="risks"]', 1.45, "top", 1300);
await say("risks", async () => {
  await sleep(900);
  const cite = page.locator('[data-demo="risks"] a').first();
  if (await cite.count()) await moveTo(cite);
});
// Model routing: the Token Factory money shot, full screen
await chapter("Model routing · Nebius Token Factory");
await cam('[data-demo="routing"]', 2.3, "center", 1400);
const tiers = await page.evaluate(() =>
  [...document.querySelectorAll('[data-demo="routing"] .font-mono')].map((e) => e.textContent.trim().split(" ")[0]),
);
await callout(`<b>${tiers[0] ?? "?"}×</b> Nano · <b>${tiers[1] ?? "?"}×</b> Super · <b>${tiers[2] ?? "?"}×</b> Ultra`);
await say("trace");
await callout(null);
await chapter(null);
await gotoDeck(7);
await kenBurns(1.06, 14000);
await say("learned");

// Whole manifest
await gotoApp("/");
await chapter("Scan a package.json · Nemotron Nano");
await click(page.getByRole("tab", { name: "Scan a manifest" }));
await sleep(300);
await say("scan", async () => {
  await click(page.getByRole("button", { name: "package.json", exact: true }));
  await page.locator('[data-demo="scan"]').waitFor();
  await cam('[data-demo="scan"]', 1.2, "top", 1300);
  await page.getByText(/screening calls?/).waitFor({ timeout: 60_000 });
});

// Calibration
await chapter("Calibrated · PyPI requests");
await cam(null, 1, "center", 900);
await click(page.getByRole("tab", { name: "One package" }));
await say("adopt", async () => {
  await click(page.getByRole("radio", { name: "PyPI" }));
  await type(input, "requests");
  await click(page.getByRole("button", { name: "Vet package" }));
  await verdictFor("requests");
  await cam('[data-demo="verdict"]', 1.5, "top", 1000);
  hit();
});
await chapter(null);
await sleep(500);

// Close: slide 12 builds in (logo, tagline, buttons) as the voice lands
await page.goto(`${BASE}/pitch?s=c-${Date.now()}#11`, { waitUntil: "networkidle" });
await inject({ cursor: false });
await slowDeck();
await page.keyboard.press("ArrowRight");
await kenBurns(1.05, 12000);
await say("close");
await sleep(2600);

await cdp.send("Page.stopScreencast");
await sleep(300);
await browser.close();

/* ---------- 5. assemble video ---------- */
frames.sort((a, b) => a.ts - b.ts);
const usable = frames.filter((f) => f.ts >= t0 - 0.5);
const vstart = usable[0].ts;
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
const dur = probe(video);

/* ---------- 6. sound: pad + hits, ducked under the voice ---------- */
const pad = join(OUT, "pad.wav");
execFileSync("ffmpeg", [
  "-y", "-v", "error", "-f", "lavfi", "-i",
  `aevalsrc='0.30*sin(2*PI*55*t)+0.22*sin(2*PI*82.41*t)+0.16*sin(2*PI*110*t)+0.10*sin(2*PI*164.81*t)+0.06*sin(2*PI*220.5*t)':s=48000:d=${dur.toFixed(2)}`,
  "-af", `lowpass=f=700,tremolo=f=0.12:d=0.35,afade=t=in:d=3,afade=t=out:st=${Math.max(0, dur - 4).toFixed(2)}:d=4,volume=0.22`,
  pad,
]);
const hitWav = join(OUT, "hit.wav");
execFileSync("ffmpeg", [
  "-y", "-v", "error", "-f", "lavfi", "-i",
  "aevalsrc='(0.9*sin(2*PI*48*t)+0.4*sin(2*PI*96*t))*exp(-3.2*t)+0.25*(random(0)*2-1)*exp(-30*t)':s=48000:d=1.6",
  "-af", "lowpass=f=1800,volume=0.8", hitWav,
]);

const args = ["-y", "-v", "error", "-i", video, "-i", pad];
for (const t of timeline) args.push("-i", t.file);
for (let i = 0; i < hits.length; i++) args.push("-i", hitWav);
const vo = timeline.map((t, i) => {
  const ms = Math.max(0, Math.round((t.at - vstart) * 1000));
  return `[${i + 2}:a]aresample=48000,adelay=${ms}|${ms}[v${i}]`;
});
const hx = hits.map((h, i) => {
  const ms = Math.max(0, Math.round((h.at - vstart) * 1000));
  return `[${i + 2 + timeline.length}:a]adelay=${ms}|${ms}[h${i}]`;
});
const voMix = `${timeline.map((_, i) => `[v${i}]`).join("")}amix=inputs=${timeline.length}:normalize=0,apad,asplit=2[vo][sc]`;
const fx = hits.length ? `;${hits.map((_, i) => `[h${i}]`).join("")}amix=inputs=${hits.length}:normalize=0,apad[fx]` : "";
const bed = `[1:a][sc]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[bed]`;
const final = `[vo][bed]${hits.length ? "[fx]" : ""}amix=inputs=${hits.length ? 3 : 2}:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=9[aout]`;
const mp4 = join(OUT, "vouch-demo.mp4");
args.push(
  "-filter_complex", [...vo, ...hx, voMix + fx, bed, final].join(";"),
  "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-shortest", "-movflags", "+faststart", mp4,
);
execFileSync("ffmpeg", args, { stdio: "inherit" });

/* ---------- 7. captions (.srt for YouTube), split into readable chunks ---------- */
const fmt = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = String(Math.floor(ms / 3.6e6)).padStart(2, "0");
  const m = String(Math.floor((ms % 3.6e6) / 6e4)).padStart(2, "0");
  const sec = String(Math.floor((ms % 6e4) / 1000)).padStart(2, "0");
  return `${h}:${m}:${sec},${String(ms % 1000).padStart(3, "0")}`;
};
let srt = "";
let n = 1;
for (const t of timeline) {
  const text = SEGMENTS[t.key];
  const chunks = text.match(/[^.!?:]+[.!?:]+["']?|\S[^.!?:]*$/g).map((s) => s.trim()).filter(Boolean);
  const total = chunks.reduce((a, c) => a + c.length, 0);
  let at = t.at - vstart;
  for (const c of chunks) {
    const d = (t.ms / 1000) * (c.length / total);
    srt += `${n++}\n${fmt(at)} --> ${fmt(at + d)}\n${c}\n\n`;
    at += d;
  }
}
writeFileSync(join(OUT, "vouch-demo.srt"), srt);

rmSync(FRAMES, { recursive: true, force: true });
rmSync(video);
console.log(`duration ${dur.toFixed(1)}s · frames ${usable.length} · hits ${hits.length}`);
console.log("MP4", mp4);
console.log("SRT", join(OUT, "vouch-demo.srt"));
