import assert from "node:assert/strict";
import test from "node:test";
import { approximateTokens, endpointUrl, executeRun, parseHeaders } from "../src/lib/benchmark-runner.ts";
import { chatChunk, chatUsage, DONE_FRAME, pacedSseResponse, sseResponse, withFetch } from "./support.ts";

test("endpointUrl appends the protocol path for a bare base URL", () => {
  assert.equal(endpointUrl("https://api.openai.com/v1", "chat"), "https://api.openai.com/v1/chat/completions");
  assert.equal(endpointUrl("https://api.openai.com/v1", "responses"), "https://api.openai.com/v1/responses");
});

test("endpointUrl trims trailing slashes and surrounding whitespace", () => {
  assert.equal(endpointUrl("  https://api.openai.com/v1/  ", "chat"), "https://api.openai.com/v1/chat/completions");
  assert.equal(endpointUrl("http://localhost:11434/v1///", "chat"), "http://localhost:11434/v1/chat/completions");
});

test("endpointUrl leaves an already-suffixed URL alone", () => {
  assert.equal(endpointUrl("https://host/v1/chat/completions", "chat"), "https://host/v1/chat/completions");
  assert.equal(endpointUrl("https://host/v1/responses", "responses"), "https://host/v1/responses");
  // A /responses URL is never rewritten even when the caller says `chat`.
  assert.equal(endpointUrl("https://host/v1/responses", "chat"), "https://host/v1/responses");
});

test("endpointUrl never rewrites the custom protocol", () => {
  assert.equal(endpointUrl("https://gateway.example/anything", "custom"), "https://gateway.example/anything");
});

test("approximateTokens is 0 for empty/whitespace and at least 1 otherwise", () => {
  assert.equal(approximateTokens(""), 0);
  assert.equal(approximateTokens("   \n\t "), 0);
  assert.equal(approximateTokens("ab"), 1);
  assert.equal(approximateTokens("abcd"), 1);
  assert.equal(approximateTokens("abcde"), 2);
  assert.equal(approximateTokens("a".repeat(400)), 100);
});

test("parseHeaders accepts an empty string and a flat string map", () => {
  assert.deepEqual(parseHeaders(""), {});
  assert.deepEqual(parseHeaders("   "), {});
  assert.deepEqual(parseHeaders('{"X-Trace":"1"}'), { "X-Trace": "1" });
});

test("parseHeaders rejects non-objects, arrays, and non-string values", () => {
  assert.throws(() => parseHeaders('"a string"'), /string values/);
  assert.throws(() => parseHeaders('["a"]'), /string values/);
  assert.throws(() => parseHeaders('{"n":1}'), /string values/);
  assert.throws(() => parseHeaders('{"n":null}'), /string values/);
  assert.throws(() => parseHeaders("not json"), SyntaxError);
});

test("executeRun measures TTFT and throughput from a paced stream", async () => {
  // 3 tokens spaced ~40ms apart; the delays are real so the metrics are real.
  const response = pacedSseResponse(
    [0, 40, 40, 40],
    [chatChunk("alpha "), chatChunk("beta "), chatChunk("gamma"), chatUsage(3)],
  );

  const result = await withFetch(
    async () => response,
    () =>
      executeRun({
        run: 1,
        endpoint: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        prompt: "hi",
        protocol: "chat",
        maxTokens: 8,
        temperature: 0,
      }),
  );

  assert.equal(result.status, "ready");
  assert.equal(result.run, 1);
  assert.equal(result.output, "alpha beta gamma");
  assert.equal(result.tokens, 3);
  assert.equal(result.tokenEvents?.length, 3);
  // The first token has no predecessor, so its delta is 0 by definition.
  assert.equal(result.tokenEvents?.[0]?.deltaMs, 0);
  // TTFT is a real elapsed time, not a constant.
  assert.ok(result.ttft > 0, `expected positive ttft, received ${result.ttft}`);
  assert.ok(result.ttft <= result.latency, "ttft must not exceed the total latency");
  // tps = tokens / (finished - firstToken)/1000
  assert.ok(result.tps > 0, `expected positive tps, received ${result.tps}`);
});

test("executeRun reports the provider token count when usage is supplied", async () => {
  const result = await withFetch(
    async () => sseResponse([`data: ${chatChunk("hello")}\n\n`, `data: ${chatUsage(999)}\n\n`, DONE_FRAME]),
    () => executeRun({ run: 2, endpoint: "https://host/v1", model: "m", prompt: "p", protocol: "chat" }),
  );

  assert.equal(result.status, "ready");
  // Provider usage wins over the local heuristic.
  assert.equal(result.tokens, 999);
});

test("executeRun falls back to the approximate token count when usage is absent", async () => {
  const result = await withFetch(
    async () => sseResponse([`data: ${chatChunk("abcdefgh")}\n\n`, DONE_FRAME]),
    () => executeRun({ run: 3, endpoint: "https://host/v1", model: "m", prompt: "p", protocol: "chat" }),
  );

  assert.equal(result.status, "ready");
  // "abcdefgh" -> ceil(8/4) = 2
  assert.equal(result.tokens, 2);
});

test("executeRun parses a non-streaming responses payload", async () => {
  const payload = { output_text: "hello there", usage: { output_tokens: 12 } };
  const result = await withFetch(
    async () => new Response(JSON.stringify(payload), { status: 200 }),
    () => executeRun({ run: 4, endpoint: "https://host/v1", model: "m", prompt: "p", protocol: "responses", stream: false }),
  );

  assert.equal(result.status, "ready");
  assert.equal(result.output, "hello there");
  assert.equal(result.tokens, 12);
  assert.deepEqual(result.tokenEvents, []);
});

test("executeRun reports reasoning deltas from chat-compatible providers", async () => {
  const reasoning = JSON.stringify({ choices: [{ delta: { reasoning_content: "thinking" } }] });
  const result = await withFetch(
    async () => sseResponse([`data: ${reasoning}\n\n`, `data: ${chatChunk("answer")}\n\n`, DONE_FRAME]),
    () => executeRun({ run: 5, endpoint: "https://host/v1", model: "m", prompt: "p", protocol: "chat" }),
  );

  assert.equal(result.status, "ready");
  assert.equal(result.output, "thinkinganswer");
  assert.equal(result.tokenEvents?.length, 2);
});

test("executeRun ignores keep-alive and malformed frames", async () => {
  const result = await withFetch(
    async () =>
      sseResponse([
        ": keep-alive\n\n",
        "data: {not json}\n\n",
        "data: \n\n",
        `data: ${chatChunk("ok")}\n\n`,
        DONE_FRAME,
      ]),
    () => executeRun({ run: 6, endpoint: "https://host/v1", model: "m", prompt: "p", protocol: "chat" }),
  );

  assert.equal(result.status, "ready");
  assert.equal(result.output, "ok");
});

test("executeRun surfaces a non-2xx response as a failed run", async () => {
  const result = await withFetch(
    async () => new Response("rate limited", { status: 429, statusText: "Too Many Requests" }),
    () => executeRun({ run: 7, endpoint: "https://host/v1", model: "m", prompt: "p", protocol: "chat" }),
  );

  assert.equal(result.status, "error");
  assert.match(result.error ?? "", /429/);
  assert.match(result.error ?? "", /rate limited/);
  assert.equal(result.tps, 0);
  assert.equal(result.tokens, 0);
});

test("executeRun reports a network failure as a failed run rather than throwing", async () => {
  const result = await withFetch(
    async () => {
      throw new TypeError("fetch failed");
    },
    () => executeRun({ run: 8, endpoint: "https://host/v1", model: "m", prompt: "p", protocol: "chat" }),
  );

  assert.equal(result.status, "error");
  assert.equal(result.error, "fetch failed");
});

test("executeRun passes an aborted signal through to fetch", async () => {
  const controller = new AbortController();
  controller.abort();
  let seenSignal: AbortSignal | undefined;

  const result = await withFetch(
    async (_input, init) => {
      seenSignal = init?.signal ?? undefined;
      assert.equal(seenSignal?.aborted, true);
      throw new Error("aborted");
    },
    () =>
      executeRun({
        run: 9,
        endpoint: "https://host/v1",
        model: "m",
        prompt: "p",
        protocol: "chat",
        signal: controller.signal,
      }),
  );

  assert.ok(seenSignal, "fetch must receive a signal");
  assert.equal(result.status, "error");
});

test("executeRun sends an Authorization header only when an API key is present", async () => {
  const headers: Array<Record<string, string>> = [];
  const capture = async (_input: unknown, init?: RequestInit) => {
    headers.push((init?.headers ?? {}) as Record<string, string>);
    return sseResponse([DONE_FRAME]);
  };

  await withFetch(capture as unknown as typeof fetch, () =>
    executeRun({ run: 1, endpoint: "https://host/v1", model: "m", prompt: "p", protocol: "chat", apiKey: "  sk-1  " }),
  );
  await withFetch(capture as unknown as typeof fetch, () =>
    executeRun({ run: 2, endpoint: "https://host/v1", model: "m", prompt: "p", protocol: "chat", apiKey: "   " }),
  );

  assert.equal(headers[0]?.Authorization, "Bearer sk-1");
  assert.equal(headers[1]?.Authorization, undefined);
  assert.equal(headers[0]?.["Content-Type"], "application/json");
});

test("executeRun omits stream_options for local endpoints but sends it for remote ones", async () => {
  const bodies: string[] = [];
  const capture = async (_input: unknown, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    return sseResponse([DONE_FRAME]);
  };

  await withFetch(capture as unknown as typeof fetch, () =>
    executeRun({ run: 1, endpoint: "http://localhost:11434/v1", model: "m", prompt: "p", protocol: "chat" }),
  );
  await withFetch(capture as unknown as typeof fetch, () =>
    executeRun({ run: 2, endpoint: "https://api.openai.com/v1", model: "m", prompt: "p", protocol: "chat" }),
  );

  assert.equal(JSON.parse(bodies[0] ?? "{}").stream_options, undefined);
  assert.deepEqual(JSON.parse(bodies[1] ?? "{}").stream_options, { include_usage: true });
  // The responses protocol uses a different payload shape entirely.
  await withFetch(capture as unknown as typeof fetch, () =>
    executeRun({ run: 3, endpoint: "https://api.openai.com/v1", model: "m", prompt: "p", protocol: "responses" }),
  );
  const responsesBody = JSON.parse(bodies[2] ?? "{}");
  assert.equal(responsesBody.input, "p");
  assert.equal(responsesBody.messages, undefined);
});
