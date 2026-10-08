import { NextRequest } from "next/server";
import { aggregateRuns } from "@/src/lib/metrics";
import { executeRun, parseHeaders } from "@/src/lib/benchmark-runner";
import type { BenchmarkRequest, EndpointProtocol, RunResult } from "@/src/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sseEvent(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: NextRequest) {
  let body: BenchmarkRequest;
  try { body = await request.json(); } catch { return Response.json({ error: "Request body must be valid JSON" }, { status: 400 }); }

  const endpoint = body.endpoint?.trim(); const model = body.model?.trim();
  if (!endpoint || !model) return Response.json({ error: "Endpoint and model are required" }, { status: 400 });
  let headers: Record<string, string>;
  try { headers = parseHeaders(body.headers ? JSON.stringify(body.headers) : ""); } catch { return Response.json({ error: "Custom headers must be a string-to-string object" }, { status: 400 }); }

  const runs = Math.min(Math.max(Number(body.runs) || 1, 1), 20);
  const concurrency = Math.min(Math.max(Number(body.concurrency) || 1, 1), 5);
  const protocol: EndpointProtocol = body.protocol ?? (endpoint.endsWith("/responses") ? "responses" : "chat");
  const prompt = body.prompt?.trim() || "Say hello in one sentence.";
  const results: RunResult[] = [];
  const controller = new AbortController();
  if (request.signal.aborted) controller.abort();
  else request.signal.addEventListener("abort", () => controller.abort(), { once: true });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      let closed = false;
      const send = (event: unknown) => {
        if (controller.signal.aborted || closed) return;
        try { streamController.enqueue(encoder.encode(sseEvent(event))); } catch { closed = true; }
      };
      try {
        send({ type: "meta", total: runs, model, endpoint, protocol });
        for (let offset = 0; offset < runs; offset += concurrency) {
          if (controller.signal.aborted) throw new Error("Benchmark cancelled");
          const batch = Array.from({ length: Math.min(concurrency, runs - offset) }, (_, index) => executeRun({
            ...body,
            endpoint, model, prompt, protocol, headers,
            maxTokens: Math.min(Math.max(Number(body.maxTokens) || 128, 1), 4096),
            temperature: Math.min(Math.max(Number(body.temperature) || 0, 0), 2),
            run: offset + index + 1,
            signal: controller.signal,
          }).then((result) => {
            results.push(result);
            send({ type: "run", result });
            send({ type: "progress", completed: results.length, total: runs });
            return result;
          }));
          await Promise.all(batch);
        }
        send({ type: "done", aggregate: aggregateRuns(results), results, completedAt: new Date().toISOString() });
      } catch (error) {
        send({ type: "error", error: error instanceof Error ? error.message : "Benchmark failed" });
      } finally {
        if (!closed) { try { streamController.close(); } catch { closed = true; } }
      }
    },
    cancel() { controller.abort(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
