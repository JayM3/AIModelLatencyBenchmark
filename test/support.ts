import type { RunResult } from "../src/lib/types.ts";

/** Install a mock provider request and always restore the real fetch. */
export async function withFetch<T>(implementation: typeof fetch, body: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  try {
    return await body();
  } finally {
    globalThis.fetch = original;
  }
}

export function runResult(overrides: Partial<RunResult> = {}): RunResult {
  return { run: 1, ttft: 400, latency: 2200, tps: 38.2, tokens: 214, status: "ready", ...overrides };
}

/** A ready `Response` carrying an SSE body built from raw frames. */
export function sseResponse(frames: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" }, ...init });
}

/**
 * SSE body that arrives over real wall-clock time, so TTFT / inter-token latency
 * assertions have something genuine to measure.
 */
export function pacedSseResponse(delays: number[], payloads: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index >= payloads.length) {
        controller.close();
        return;
      }
      const delay = delays[index] ?? 0;
      const payload = payloads[index] ?? "";
      index += 1;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/** chat-completions chunk with a single content delta. */
export function chatChunk(content: string): string {
  return JSON.stringify({ choices: [{ delta: { content } }] });
}

export function chatUsage(tokens: number): string {
  return JSON.stringify({ choices: [{ delta: {} }], usage: { completion_tokens: tokens } });
}

export const DONE_FRAME = "data: [DONE]\n\n";
