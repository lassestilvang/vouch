# Devpost submission kit

Paste-ready text for the Devpost form, plus the demo video script. Numbers come from live runs on 2026-10-29.

## Links for the form

- Working demo: https://vouch-phi-one.vercel.app
- Code: https://github.com/lassestilvang/vouch (MIT)
- Pitch deck: https://vouch-phi-one.vercel.app/pitch
- Video: upload `.demo/vouch-demo.mp4` to YouTube as **Public**, then paste the link here

## Track

Best Apps and Agents

## Tagline

An agent that vets npm and PyPI packages before you install them, using Nemotron on Nebius Token Factory.

## Project description

### Inspiration

Every `npm install` or `pip install` runs a stranger's code with your permissions. Supply-chain attacks keep working because the warning signs are scattered: a maintainer handoff mentioned in a GitHub issue, a security blog post about a hijacked release, a package name one letter away from a popular one. AI coding assistants made it worse. They confidently suggest packages that don't exist, and attackers now register those hallucinated names ("slopsquatting"). Nobody reads ten tabs of research before adding a dependency, so we built an agent that does it in about 30 seconds.

### What it does

Type a package name. Vouch returns:

- a verdict (**Adopt**, **Use with caution** or **Avoid**) with a confidence level
- scores for security, maintenance, supply chain, adoption and license
- concrete risks, each cited to an OSV advisory or a web source you can click
- safer alternatives, each of which you can vet with one click

You can also paste a whole `package.json` or `requirements.txt`. Nemotron Nano screens every dependency in seconds, and you pick the risky ones for a full Nemotron Ultra investigation.

Hard facts appear within about a second: downloads, release history, advisories affecting the latest version, archived repos, install scripts, npm build provenance, OpenSSF Scorecard, typosquat distance, and whether the package exists at all. Then you watch the agent research and reason in a live trace.

### How we built it

A five-stage pipeline streamed to a Next.js UI:

1. **Collect facts with no LLM**: npm/PyPI registries, deps.dev, OSV.dev, GitHub, OpenSSF Scorecard. These become rule-based signals, so the most important facts can't be hallucinated.
2. **Plan with Nemotron 3 Super**: it writes targeted web searches based on the risks visible in the facts.
3. **Search with Tavily**: parallel queries, de-duplicated sources.
4. **Triage with Nemotron 3 Nano**: parallel calls decide, for each source, whether it is about this exact package (filtering out homonyms), which risk dimension it affects, and how severe it is.
5. **Verdict with Nemotron 3 Ultra**: one reasoning call over the facts plus the distilled evidence produces a structured, cited verdict.

This follows the routing pattern the track describes. The cheap, fast Nano handles most calls and tokens. Ultra runs once and sees only distilled evidence, never raw web pages. A typical run makes about 7 model calls (1 Super, 5 Nano, 1 Ultra) and uses about 10,000 tokens in 20–28 s. Super plans in under a second, each Nano triage call takes under 2 s, and Ultra spends about 16 s reasoning. Screening a 9-dependency `package.json` takes about 3 s and 2 Nano calls. Model ids are discovered from Token Factory's `/v1/models`, so the app picks up the served Nemotron 3 models automatically.

Every model reply is validated against a Zod schema. Reasoning blocks are stripped, and an invalid reply gets one repair round with the parse error. Web content is treated as untrusted data in every prompt. If the model layer fails, Vouch still returns a rule-based verdict.

### Challenges

- **Turning reasoning off.** Our first live run returned no triage at all. Nemotron 3 reasons by default, so Nano used up its token budget thinking about simple classifications. The `/no_think` prompt switch has no effect on Token Factory. Passing `chat_template_kwargs: {"enable_thinking": false}` does: extraction calls became about 3× faster with about 5× fewer tokens. Reasoning now stays on for Ultra only.
- **Homonyms.** Packages like `colors` or `request` share names with ordinary words. A small model with a strict "this exact package" rule removes most of the noise before Ultra sees it.
- **Calibration.** Popular packages have long advisory histories. The verdict prompt weighs whether a vulnerability affects the *latest* version and how recent the evidence is, so `requests` isn't flagged for a CVE fixed in 2018.
- **False positives in rule-based checks.** Our first typosquat check flagged `@babel/core` as a lookalike of `cors`. Comparing full scoped names and skipping established packages fixed it.

### Accomplishments

- It catches real incidents end to end: `event-stream` (hijacked), `lodahs` (typosquat), `colors` (sabotaged), and `reqeusts` (doesn't exist, slopsquat bait).
- Facts show up in about a second, and the full verdict arrives in 20–28 s.
- Verdicts are calibrated on real runs: `event-stream`, `colors`, `request`, `left-pad` and `lodahs` get **Avoid**, while `requests` and `zod` get **Adopt** despite their long advisory histories.
- It degrades gracefully: without Token Factory you still get the facts and a rule-based verdict.

### What we learned

Right-sizing models matters more than using the biggest one everywhere. Nano is very good at narrow extraction when the contract is strict, and Ultra is worth its cost exactly once per run, on the decision.

### What's next

- Lockfile scanning, including transitive dependencies
- A GitHub Action that comments on PRs that add new dependencies
- More ecosystems (crates.io, Go, Maven)
- An MCP server, so coding agents can check packages *before* suggesting them

### Built with

NVIDIA Nemotron 3 (Nano, Super, Ultra), Nebius Token Factory, Tavily, Next.js, TypeScript, Bun, OSV.dev, deps.dev, OpenSSF Scorecard, GitHub API

## Demo video (2:43)

Recorded automatically from the real app and CLI by `scripts/record-demo.mjs`, with live Nemotron calls. Files: `.demo/vouch-demo.mp4` (1080p) and `.demo/vouch-demo.srt` (upload as YouTube captions). The narration text lives in `SEGMENTS` in that script.

Scene order:
1. Cold open in a terminal. `vouch pip install reqeusts` is blocked in under half a second, before any model runs.
2. Title, then the problem: the event-stream hijack in 2018 and slopsquatting (1 in 5 suggested names don't exist).
3. `vouch npm install event-stream`: a live investigation in the CLI, and the install is blocked.
4. The same run in the web app, replayed at speed with real timings, then the cited verdict and risks.
5. A full-screen zoom on the model routing panel: Nano, Super, Ultra on Token Factory.
6. What we learned: `enable_thinking: false` made Nano 3× faster with 5× fewer tokens.
7. A manifest scan of the sample package.json, then `requests` comes back Adopt.
8. Close on the deck's final slide with the live URL and repo.

Suggested YouTube title: **Vouch: an AI agent that vets npm and PyPI packages before you install them (Nemotron on Nebius)**

## Token Factory and NVIDIA feedback (for the feedback field and the $100 feedback prize)

Measured during the build. Add your own onboarding experience (signup, credits form) at the top.

**What worked well**
- The OpenAI-compatible API meant the stock `openai` SDK worked with only a `baseURL` change. We had our first successful call within minutes of getting a key.
- Latency is good for interactive agents. With reasoning off, a Nano extraction call took 0.3–2 s and a Super call about 0.7 s. An Ultra reasoning call over about 3,000 tokens of evidence took about 16 s.
- No 429s or 5xxs, even with 5–6 parallel Nano calls per run and several runs at the same time.

**Friction**
1. **Reasoning control isn't discoverable.** Nemotron 3 models reason by default. The documented-for-Nemotron `/no_think` system-prompt switch has no effect on Token Factory: the reasoning trace still comes back. `reasoning_effort: "low"` reduced reasoning on Super but not on Nano, and `chat_template_kwargs.thinking: false` was ignored. Only `chat_template_kwargs: {"enable_thinking": false}` turned it off. We found it by trial and error. Please document it per model on the model card, ideally with a first-class `reasoning: off|low|high` parameter that behaves the same across models.
2. **Inconsistent model id casing.** `/v1/models` lists `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, `nvidia/nemotron-3-super-120b-a12b` and `nvidia/Nemotron-3-Ultra-550b-a55b`, in three different casing styles within one model family. Community examples use other spellings again. We ended up matching ids by regex against `/v1/models`. Stable aliases such as `nvidia/nemotron-3-nano` would help.
3. **Silent budget exhaustion.** When reasoning uses up `max_tokens`, `content` is empty and the answer is lost inside the reasoning trace. A clear signal for this (for example a distinct `finish_reason`) would make the failure easier to spot.

**Request:** a per-model "capabilities" field in `/v1/models` (reasoning toggle, JSON mode, context length, price per token) so agents can route between tiers programmatically.
