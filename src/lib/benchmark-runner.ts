import type { BenchmarkRequest, EndpointProtocol, RunResult, TokenEvent } from "./types";

export type RunUpdate = { type: "run"; result: RunResult };
export type ProgressUpdate = { type: "progress"; completed: number; total: number };
export type DoneUpdate = { type: "done"; aggregate: ReturnType<typeof import("./metrics").aggregateRuns>; completedAt: string };
export type ErrorUpdate = { type: "error"; error: string };
export type BenchmarkUpdate = RunUpdate | ProgressUpdate | DoneUpdate | ErrorUpdate;

function endpointUrl(rawEndpoint: string, protocol: EndpointProtocol) {
  const raw = rawEndpoint.trim().replace(/\/$/, "");
  if (protocol === "custom" || raw.endsWith("/responses") || raw.endsWith("/chat/completions")) return raw;
  return `${raw}/${protocol === "responses" ? "responses" : "chat/completions"}`;
}

function approximateTokens(text: string) {
  if (!text.trim()) return 0;
  // A rough BPE proxy for unknown/custom models; provider usage remains authoritative.
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

function deltaText(value: any, protocol: EndpointProtocol) {
  if (protocol === "responses") return typeof value?.delta === "string" ? value.delta : "";
  const delta = value?.choices?.[0]?.delta;
  if (typeof delta?.content === "string") return delta.content;
  if (typeof delta?.reasoning_content === "string") return delta.reasoning_content;
  if (typeof delta?.reasoning === "string") return delta.reasoning;
  return typeof value?.delta === "string" ? value.delta : "";
}

function usageCount(value: any) {
  return Number(value?.usage?.completion_tokens ?? value?.response?.usage?.output_tokens ?? value?.response?.usage?.completion_tokens ?? 0);
}

function responseOutput(value: any, protocol: EndpointProtocol) {
  if (protocol === "responses" && typeof value?.output_text === "string") return value.output_text;
  if (typeof value?.choices?.[0]?.message?.content === "string") return value.choices[0].message.content;
  if (typeof value?.choices?.[0]?.message?.reasoning_content === "string") return value.choices[0].message.reasoning_content;
  return typeof value?.output_text === "string" ? value.output_text : "";
}

function isLocalEndpoint(endpoint: string) {
  try {
    const hostname = new URL(endpoint).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1";
  } catch {
    return false;
  }
}

function requestPayload(input: BenchmarkRequest & { model: string; prompt: string; protocol: EndpointProtocol }) {
  if (input.protocol === "responses") return { model: input.model, input: input.prompt, max_output_tokens: input.maxTokens, temperature: input.temperature, stream: input.stream !== false };
  const includeUsage = input.stream !== false && !isLocalEndpoint(input.endpoint ?? "");
  return {
    model: input.model,
    messages: [{ role: "user", content: input.prompt }],
    max_tokens: input.maxTokens,
    temperature: input.temperature,
    stream: input.stream !== false,
    ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
  };
}

export async function executeRun(input: BenchmarkRequest & { run: number; endpoint: string; model: string; prompt: string; protocol: EndpointProtocol; signal?: AbortSignal }): Promise<RunResult> {
  const started = performance.now();
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: input.stream === false ? "application/json" : "text/event-stream", ...(input.headers ?? {}) };
  if (input.apiKey?.trim()) headers.Authorization = `Bearer ${input.apiKey.trim()}`;
  try {
    const timeoutSignal = AbortSignal.timeout(120_000);
    const signal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal;
    const response = await fetch(endpointUrl(input.endpoint, input.protocol), {
      method: "POST", headers, body: JSON.stringify(requestPayload(input)), cache: "no-store", signal,
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} · ${(await response.text()).slice(0, 240)}`);

    let text = ""; let providerTokens = 0; let firstTokenAt: number | undefined; let lastTokenAt: number | undefined;
    const tokenEvents: TokenEvent[] = [];
    if (input.stream !== false && response.body) {
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let done = false;
      while (!done) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          if (payload === "[DONE]") { done = true; await reader.cancel().catch(() => undefined); break; }
          try {
            const parsed = JSON.parse(payload); const now = performance.now(); const delta = deltaText(parsed, input.protocol);
            if (delta) {
              const deltaMs = lastTokenAt === undefined ? 0 : now - lastTokenAt;
              firstTokenAt ??= now; lastTokenAt = now; text += delta;
              tokenEvents.push({ index: tokenEvents.length + 1, atMs: now - started, deltaMs, text: delta });
            }
            providerTokens = usageCount(parsed) || providerTokens;
          } catch { /* Ignore malformed data and keep-alive frames. */ }
        }
        if (chunk.done) done = true;
      }
      if (buffer.trim().startsWith("data:")) {
        const payload = buffer.trim().slice(5).trim();
        if (payload && payload !== "[DONE]") {
          try {
            const parsed = JSON.parse(payload); const now = performance.now(); const delta = deltaText(parsed, input.protocol);
            if (delta) {
              const deltaMs = lastTokenAt === undefined ? 0 : now - lastTokenAt;
              firstTokenAt ??= now; lastTokenAt = now; text += delta;
              tokenEvents.push({ index: tokenEvents.length + 1, atMs: now - started, deltaMs, text: delta });
            }
            providerTokens = usageCount(parsed) || providerTokens;
          } catch { /* Ignore an incomplete trailing frame. */ }
        }
      }
    } else {
      const parsed = await response.json(); text = responseOutput(parsed, input.protocol); providerTokens = usageCount(parsed);
      // Non-streaming responses do not expose first-token arrival; use request latency as the honest throughput window.
    }
    const finished = performance.now(); const latency = finished - started; const ttft = (firstTokenAt ?? finished) - started;
    const tokens = providerTokens || approximateTokens(text);
    const generationDuration = firstTokenAt !== undefined ? Math.max((finished - firstTokenAt) / 1000, 0.001) : Math.max(latency / 1000, 0.001);
    return { run: input.run, ttft, latency, tps: tokens / generationDuration, tokens, status: "ready", output: text.slice(0, 4000), tokenEvents: tokenEvents.slice(0, 500) };
  } catch (error) {
    const latency = performance.now() - started;
    return { run: input.run, ttft: latency, latency, tps: 0, tokens: 0, status: "error", error: error instanceof Error ? error.message : "Request failed" };
  }
}

export function parseHeaders(value: string): Record<string, string> {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((header) => typeof header !== "string")) {
    throw new Error("Custom headers must be a JSON object with string values");
  }
  return parsed as Record<string, string>;
}
