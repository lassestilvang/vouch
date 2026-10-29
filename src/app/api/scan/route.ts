import { MAX_DEPS, parseManifest } from "@/lib/manifest";
import { allow, clientIp } from "@/lib/ratelimit";
import { scan } from "@/lib/scan";
import type { ScanEvent } from "@/lib/types";

export const maxDuration = 300;

export async function POST(req: Request) {
  let body: { manifest?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const text = String(body.manifest ?? "");
  if (text.length > 200_000) return Response.json({ error: "manifest too large" }, { status: 413 });
  let manifest;
  try {
    manifest = parseManifest(text);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  if (!manifest.deps.length) return Response.json({ error: "no registry dependencies found" }, { status: 400 });

  // A scan costs roughly one check per 10 dependencies.
  const cost = 1 + Math.ceil(Math.min(manifest.deps.length, MAX_DEPS) / 10);
  if (!allow(`vet:${clientIp(req)}`, cost)) return Response.json({ error: "rate limit reached, try again in a few minutes" }, { status: 429 });

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ScanEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        await scan(manifest, send);
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
