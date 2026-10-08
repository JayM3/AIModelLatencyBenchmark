import assert from "node:assert/strict";
import test from "node:test";
import { clamp, runBenchmark, type BenchmarkEvent, type RunBenchmarkOptions } from "../src/lib/benchmark.ts";
import { chatChunk, chatUsage, DONE_FRAME, sseResponse, withFetch } from "./support.ts";

function benchmarkOptions(overrides: Partial<RunBenchmarkOptions> = {}): RunBenchmarkOptions {
  return { endpoint: "https://provider.example/v1", model: "test-model", prompt: "hello", protocol: "chat", ...overrides };
}

function successfulResponse(): Response {
  return sseResponse([
    `data: ${chatChunk("hello")}

`,
    `data: ${chatUsage(1)}

`,
    DONE_FRAME,
  ]);
}

test("clamp enforces request limits and normalizes integer counts", () => {
  assert.equal(clamp(999, "runs", 1), 20);
  assert.equal(clamp(-10, "runs", 1), 1);
  assert.equal(clamp(3.9, "runs", 1), 3);
  assert.equal(clamp("2.8", "concurrency", 1), 2);
  assert.equal(clamp(99, "concurrency", 1), 5);
  assert.equal(clamp(8.5, "maxTokens", 128), 8);
  assert.equal(clamp(9999, "maxTokens", 128), 4096);
  assert.equal(clamp(0, "temperature", 0.2), 0);
  assert.equal(clamp("0", "temperature", 0.2), 0);
  assert.equal(clamp(0.35, "temperature", 0), 0.35);
  assert.equal(clamp(3, "temperature", 0), 2);
});

test("clamp uses defaults for missing, non-numeric, and non-finite values", () => {
  for (const value of [undefined, null, "", "  ", "fast", NaN, Infinity, -Infinity, true, {}, []]) {
    assert.equal(clamp(value, "maxTokens", 128), 128);
  }
});

test("runBenchmark emits metadata, monotonic progress, and a complete response", async () => {
  const events: BenchmarkEvent[] = [];
  const result = await withFetch(async () => successfulResponse(), () =>
    runBenchmark(benchmarkOptions({ runs: 3, onEvent: (event) => events.push(event) })),
  );

  assert.equal(events[0]?.type, "meta");
  assert.deepEqual(events.filter((event) => event.type === "run").map((event) => event.completed), [1, 2, 3]);
  assert.deepEqual(result.results.map((run) => run.run), [1, 2, 3]);
  assert.equal(result.aggregate.completed, 3);
  assert.equal(result.aggregate.failed, 0);
  assert.equal(result.model, "test-model");
  assert.equal(result.endpoint, "https://provider.example/v1");
  assert.equal(result.protocol, "chat");
  assert.ok(Number.isFinite(Date.parse(result.completedAt)));
  const done = events.at(-1);
  assert.ok(done?.type === "done");
  assert.equal(done.response, result);
});

test("runBenchmark respects concurrency and executes a partial final batch", async () => {
  let inFlight = 0;
  let peak = 0;
  const result = await withFetch(async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return successfulResponse();
  }, () => runBenchmark(benchmarkOptions({ runs: 5, concurrency: 2 })));

  assert.equal(peak, 2);
  assert.equal(inFlight, 0);
  assert.deepEqual(result.results.map((run) => run.run).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

test("runBenchmark clamps fractional counts before scheduling", async () => {
  let attempts = 0;
  const result = await withFetch(async () => {
    attempts += 1;
    return successfulResponse();
  }, () => runBenchmark(benchmarkOptions({ runs: 3.9, concurrency: 2.8 })));

  assert.equal(attempts, 3);
  assert.equal(result.results.length, 3);
  assert.deepEqual(result.results.map((run) => run.run).sort((a, b) => a - b), [1, 2, 3]);
});

test("runBenchmark clamps provider options and retains valid zero temperature", async () => {
  let seenUrl: string | undefined;
  let seenBody: Record<string, unknown> = {};
  let seenHeaders: Record<string, string> = {};
  await withFetch(async (url, init) => {
    seenUrl = String(url);
    seenBody = JSON.parse(String(init?.body));
    seenHeaders = init?.headers as Record<string, string>;
    return successfulResponse();
  }, () => runBenchmark(benchmarkOptions({ apiKey: "secret", headers: { "X-Trace": "yes" }, maxTokens: 9999, temperature: 0 })));

  assert.equal(seenUrl, "https://provider.example/v1/chat/completions");
  assert.equal(seenBody.max_tokens, 4096);
  assert.equal(seenBody.temperature, 0);
  assert.equal(seenHeaders.Authorization, "Bearer secret");
  assert.equal(seenHeaders["X-Trace"], "yes");
});

test("runBenchmark records failures once without retrying requests", async () => {
  let attempts = 0;
  const result = await withFetch(async () => {
    attempts += 1;
    return attempts === 1 ? new Response("failed", { status: 500 }) : successfulResponse();
  }, () => runBenchmark(benchmarkOptions({ runs: 2 })));

  assert.equal(attempts, 2);
  assert.equal(result.results[0]?.status, "error");
  assert.equal(result.results[1]?.status, "ready");
  assert.equal(result.aggregate.completed, 1);
  assert.equal(result.aggregate.failed, 1);
  assert.equal(result.aggregate.tokens.mean, 1);
});

test("runBenchmark rejects an aborted request without starting provider calls", async () => {
  const controller = new AbortController();
  controller.abort();
  const events: BenchmarkEvent[] = [];
  let attempts = 0;
  await withFetch(async () => {
    attempts += 1;
    return successfulResponse();
  }, () => assert.rejects(() => runBenchmark(benchmarkOptions({
    runs: 2,
    signal: controller.signal,
    onEvent: (event) => events.push(event),
  })), { name: "AbortError" }));

  assert.equal(attempts, 0);
  assert.deepEqual(events, []);
});

test("runBenchmark stops between batches when cancelled from a progress event", async () => {
  const controller = new AbortController();
  const events: BenchmarkEvent[] = [];
  let attempts = 0;
  await withFetch(async () => {
    attempts += 1;
    return successfulResponse();
  }, () => assert.rejects(() => runBenchmark(benchmarkOptions({
    runs: 3,
    signal: controller.signal,
    onEvent: (event) => {
      events.push(event);
      if (event.type === "run") controller.abort();
    },
  })), { name: "AbortError" }));

  assert.equal(attempts, 1);
  assert.deepEqual(events.map((event) => event.type), ["meta", "run"]);
});

test("runBenchmark does not emit completion after cancellation during the final run", async () => {
  const controller = new AbortController();
  const events: BenchmarkEvent[] = [];
  await withFetch(async () => {
    controller.abort();
    return successfulResponse();
  }, () => assert.rejects(() => runBenchmark(benchmarkOptions({
    signal: controller.signal,
    onEvent: (event) => events.push(event),
  })), { name: "AbortError" }));

  assert.deepEqual(events.map((event) => event.type), ["meta"]);
});
