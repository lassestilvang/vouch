import OpenAI from "openai";
import type { z } from "zod";
import type { LlmCall } from "./types";

export type Tier = "nano" | "super" | "ultra";

const BASE_URL = process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1/";

// Preference order per tier. The first id that Token Factory actually serves wins,
// so the app keeps working when model ids are renamed. Env vars override everything.
const PATTERNS: Record<Tier, RegExp[]> = {
  nano: [/nemotron-3-nano/i, /nemotron.*nano/i],
  super: [/nemotron-3-super/i, /nemotron.*super/i],
  ultra: [/nemotron-3-ultra/i, /nemotron.*ultra/i],
};
const FALLBACK_IDS: Record<Tier, string> = {
  nano: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
  super: "nvidia/Nemotron-3-Super-120B-A12B",
  ultra: "nvidia/Nemotron-3-Ultra-550b-a55b",
};
const ENV: Record<Tier, string | undefined> = {
  nano: process.env.VOUCH_MODEL_NANO,
  super: process.env.VOUCH_MODEL_SUPER,
  ultra: process.env.VOUCH_MODEL_ULTRA,
};

let client: OpenAI | null = null;
function getClient() {
  if (!process.env.NEBIUS_API_KEY) throw new Error("NEBIUS_API_KEY is not set");
  client ??= new OpenAI({ baseURL: BASE_URL, apiKey: process.env.NEBIUS_API_KEY, timeout: 120_000, maxRetries: 1 });
  return client;
}

let resolved: Promise<Record<Tier, string>> | null = null;

/** Map each tier to a served model id, falling back to a smaller Nemotron tier if one is missing. */
export function resolveModels(): Promise<Record<Tier, string>> {
  resolved ??= (async () => {
    let ids: string[] = [];
    try {
      const list = await getClient().models.list();
      for await (const m of list) ids.push(m.id);
    } catch {
      ids = [];
    }
    const pick = (t: Tier) => {
      if (ENV[t]) return ENV[t]!;
      for (const p of PATTERNS[t]) {
        // Prefer the shortest match: base instruct model over -FP8 / -Base variants.
        const hit = ids.filter((id) => p.test(id) && !/base|reward|embed/i.test(id)).sort((a, b) => a.length - b.length)[0];
        if (hit) return hit;
      }
      return undefined;
    };
    const nano = pick("nano");
    const sup = pick("super");
    const ultra = pick("ultra");
    if (!ids.length) return { ...FALLBACK_IDS, ...Object.fromEntries(Object.entries(ENV).filter(([, v]) => v)) } as Record<Tier, string>;
    const any = ultra ?? sup ?? nano ?? FALLBACK_IDS.super;
    return { nano: nano ?? sup ?? any, super: sup ?? ultra ?? any, ultra: ultra ?? sup ?? any };
  })();
  return resolved;
}

/** Nemotron reasoning models may emit <think> blocks; keep only the answer. */
export function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*<\/think>/i, "").trim();
}

/** Pull the first balanced JSON object or array out of a model reply. */
export function extractJson(text: string): unknown {
  const t = stripReasoning(text).replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(t);
  } catch {
    /* fall through to scanning */
  }
  const start = t.search(/[[{]/);
  if (start < 0) throw new Error("no JSON in model reply");
  const open = t[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new Error("unterminated JSON in model reply");
}

let callSeq = 0;

export interface JsonCallOptions<T> {
  tier: Tier;
  stage: LlmCall["stage"];
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  /** Ask the model to reason first. Off for fast tiers to save latency and credits. */
  think?: boolean;
  onCall?: (c: LlmCall) => void;
}

/** One chat completion that must return JSON matching `schema`. Retries once with the parse error. */
export async function jsonCall<T>(o: JsonCallOptions<T>): Promise<T> {
  const models = await resolveModels();
  const model = models[o.tier];
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: `${o.think ? "" : "/no_think\n"}${o.system}\nReply with JSON only. No markdown fences.` },
    { role: "user", content: o.user },
  ];
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    const id = `c${++callSeq}`;
    try {
      const res = await getClient().chat.completions.create({
        model,
        messages,
        temperature: o.think ? 0.6 : 0.2,
        max_tokens: o.maxTokens ?? 2048,
      });
      const text = res.choices[0]?.message?.content ?? "";
      const call: LlmCall = {
        id, stage: o.stage, tier: o.tier, model, ms: Date.now() - t0,
        promptTokens: res.usage?.prompt_tokens, completionTokens: res.usage?.completion_tokens, ok: true,
      };
      try {
        const parsed = o.schema.parse(extractJson(text));
        o.onCall?.(call);
        return parsed;
      } catch (e) {
        o.onCall?.({ ...call, ok: false, error: "invalid JSON, retrying" });
        lastErr = e;
        messages.push({ role: "assistant", content: text.slice(0, 4000) }, {
          role: "user",
          content: `That reply was not valid JSON for the required shape (${String((e as Error).message).slice(0, 300)}). Reply again with only the corrected JSON.`,
        });
      }
    } catch (e) {
      o.onCall?.({ id, stage: o.stage, tier: o.tier, model, ms: Date.now() - t0, ok: false, error: (e as Error).message.slice(0, 200) });
      throw e;
    }
  }
  throw lastErr;
}
