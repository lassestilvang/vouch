import { vet } from "@/lib/agent";
import { normalizeName } from "@/lib/facts";
import { allow, clientIp } from "@/lib/ratelimit";
import type { Ecosystem, VetEvent } from "@/lib/types";

export const maxDuration = 300;

export async function POST(req: Request) {
  let body: { ecosystem?: string; name?: string; fresh?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const ecosystem = body.ecosystem as Ecosystem;
  if (ecosystem !== "npm" && ecosystem !== "pypi") return Response.json({ error: "ecosystem must be npm or pypi" }, { status: 400 });
  const name = normalizeName(ecosystem, String(body.name ?? ""));
  if (!name) return Response.json({ error: "invalid package name" }, { status: 400 });

  if (!allow(`vet:${clientIp(req)}`)) return Response.json({ error: "rate limit reached, try again in a few minutes" }, { status: 429 });

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: VetEvent) => {
        if (!closed) controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      };
      try {
        await vet(ecosystem, name, send, { fresh: !!body.fresh });
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
