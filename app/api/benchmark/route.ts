import type { NextRequest } from "next/server";
import { runBenchmark, type BenchmarkEvent } from "@/src/lib/benchmark";
import { isJsonRequest, normalizeBenchmarkRequest, type ValidatedBenchmarkRequest } from "@/src/lib/request-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sseEvent(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * HTTP/SSE adapter around the benchmark engine.
 *
 * All batching, clamping, and metric aggregation live in `runBenchmark`, so this
 * route only translates a request body into engine options and engine events into
 * the SSE frames the browser client already understands
 * (`meta` / `run` / `progress` / `done` / `error`).
 */
export async function POST(request: NextRequest) {
  if (!isJsonRequest(request)) return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  let body: ValidatedBenchmarkRequest;
  try {
    body = normalizeBenchmarkRequest(await request.json());
  } catch (error) {
    return Response.json({ error: error instanceof SyntaxError ? "Request body must be valid JSON" : error instanceof Error ? error.message : "Invalid benchmark request" }, { status: 400 });
  }
  const { endpoint, model, prompt, protocol, headers } = body;
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal]);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      let closed = false;
      const send = (event: unknown) => {
        if (signal.aborted || closed) return;
        try { streamController.enqueue(encoder.encode(sseEvent(event))); } catch { closed = true; controller.abort(); }
      };
      const onEvent = (event: BenchmarkEvent) => {
        if (event.type === "meta") {
          send({ type: "meta", total: event.total, model: event.model, endpoint: event.endpoint, protocol: event.protocol });
          return;
        }
        if (event.type === "run") {
          send({ type: "run", result: event.result });
          send({ type: "progress", completed: event.completed, total: event.total });
          return;
        }
        send({
          type: "done",
          aggregate: event.response.aggregate,
          results: event.response.results,
          completedAt: event.response.completedAt,
        });
      };
      try {
        await runBenchmark({
          ...body,
          endpoint, model, prompt, protocol, headers,
          signal,
          onEvent,
        });
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
