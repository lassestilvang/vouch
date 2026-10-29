# Devpost submission kit

Paste-ready text for the Devpost form, plus the demo video script. Items in **[brackets]** need real numbers from a live run.

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

This follows the routing pattern the track describes. The cheap, fast Nano handles most calls and tokens. Ultra runs once and sees only distilled evidence, never raw web pages. A typical run makes **[~8]** model calls and uses **[N]** tokens in **[~25 s]**. Model ids are discovered from Token Factory's `/v1/models`, so the app picks up the served Nemotron 3 models automatically.

Every model reply is validated against a Zod schema. Reasoning blocks are stripped, and an invalid reply gets one repair round with the parse error. Web content is treated as untrusted data in every prompt. If the model layer fails, Vouch still returns a rule-based verdict.

### Challenges

- **Homonyms.** Packages like `colors` or `request` share names with ordinary words. A small model with a strict "this exact package" rule removes most of the noise before Ultra sees it.
- **Calibration.** Popular packages have long advisory histories. The verdict prompt weighs whether a vulnerability affects the *latest* version and how recent the evidence is, so `requests` isn't flagged for a CVE fixed in 2018.
- **False positives in rule-based checks.** Our first typosquat check flagged `@babel/core` as a lookalike of `cors`. Comparing full scoped names and skipping established packages fixed it.

### Accomplishments

- It catches real incidents end to end: `event-stream` (hijacked), `lodahs` (typosquat), `colors` (sabotaged), and `reqeusts` (doesn't exist, slopsquat bait).
- Facts show up in about a second, and the full verdict arrives in **[~25 s]**.
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

## Demo video script (≤ 3:00)

| Time | Show | Say |
|---|---|---|
| 0:00–0:20 | Title, then a terminal typing `npm install` | "Every install runs a stranger's code. Attacks hide in maintainer handoffs, typosquats and names AI assistants hallucinate. Vouch checks a package before you install it." |
| 0:20–1:05 | Vet `event-stream`. Facts land, the trace runs, the verdict comes in | "Hard facts first: OSV advisory, archived repo, eight years without a release. Nemotron Super plans the searches, Tavily runs them, Nemotron Nano triages every source in parallel, and Nemotron Ultra reasons to a cited verdict. Avoid, with the 2018 hijack cited." |
| 1:05–1:25 | Click a citation, then an alternative | "Every claim links to its source. Alternatives are one click to vet." |
| 1:25–1:50 | Vet `reqeusts` (PyPI) | "This is what an AI assistant might suggest. It doesn't exist. If someone registers it tomorrow, it's malware. Vouch says so and suggests `requests`." |
| 1:50–2:00 | Vet `lodahs` | "A typosquat that npm already pulled. Caught by the facts layer, no LLM needed." |
| 2:00–2:20 | Scan a manifest: the sample package.json | "Or paste a whole package.json. Nano screens every dependency in a few seconds, and the risky ones float to the top. Deep dive sends just those to Ultra." |
| 2:20–2:35 | Zoom in on the model routing panel | "Here's the routing on Token Factory: [6] Nano calls, one Super, one Ultra. Most tokens go to the cheapest model." |
| 2:35–3:00 | README architecture, repo URL | "Open source under MIT, deployed on [host]. Vouch: know what you install." |

## Token Factory and NVIDIA feedback (for the feedback field and the $100 feedback prize)

Write this from real experience during the build. Notes to fill in:

- Onboarding: how long from signup to the first successful call; credits form experience
- Model discovery: were Nemotron 3 ids easy to find? Do ids in docs match `/v1/models`? (We saw inconsistent casing in community examples, e.g. `Ultra-550b-a55b` vs `Ultra-550B-A55B`.)
- Reasoning control: how to turn thinking on or off for Nemotron 3 on Token Factory (`/no_think`, `chat_template_kwargs`, or a `reasoning_effort` equivalent), and whether it's documented
- Structured output: does `response_format` / JSON schema work for Nemotron models?
- Latency per tier: measured Nano, Super and Ultra latency from the trace panel
- Rate limits and errors: any 429s or 5xxs during parallel Nano calls
- One concrete improvement request
