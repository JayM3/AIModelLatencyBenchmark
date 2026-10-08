import type { Distribution, EndpointProtocol, RunResult, SavedBenchmark, TokenEvent } from "./types.ts";

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(field + " must be an object");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, required = false): string {
  if (typeof value !== "string" || (required && !value.trim())) {
    throw new Error(field + " must be " + (required ? "a non-empty string" : "a string"));
  }
  return value;
}

function optionalText(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : text(value, field);
}

function number(value: unknown, field: string, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new Error(field + " must be a finite, non-negative " + (integer ? "integer" : "number"));
  }
  return value;
}

function boolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(field + " must be a boolean");
  return value;
}

function distribution(value: unknown, field: string): Distribution {
  const source = object(value, field);
  return {
    mean: number(source.mean, field + ".mean"),
    median: number(source.median, field + ".median"),
    p50: number(source.p50, field + ".p50"),
    p95: number(source.p95, field + ".p95"),
    min: number(source.min, field + ".min"),
    max: number(source.max, field + ".max"),
    stdev: number(source.stdev, field + ".stdev"),
  };
}

function tokenEvent(value: unknown): TokenEvent {
  const event = object(value, "token event");
  return {
    index: number(event.index, "token event index", true),
    atMs: number(event.atMs, "token event atMs"),
    deltaMs: number(event.deltaMs, "token event deltaMs"),
    text: optionalText(event.text, "token event text"),
  };
}

function runResult(value: unknown): RunResult {
  const run = object(value, "result");
  if (run.status !== "pending" && run.status !== "ready" && run.status !== "error") {
    throw new Error("Invalid result status");
  }
  if (run.tokenEvents !== undefined && !Array.isArray(run.tokenEvents)) {
    throw new Error("Result tokenEvents must be an array");
  }
  return {
    run: number(run.run, "result run", true),
    ttft: number(run.ttft, "result ttft"),
    latency: number(run.latency, "result latency"),
    tps: number(run.tps, "result tps"),
    tokens: number(run.tokens, "result tokens"),
    status: run.status,
    output: optionalText(run.output, "result output"),
    error: optionalText(run.error, "result error"),
    tokenEvents: (run.tokenEvents as unknown[] | undefined)?.map(tokenEvent),
  };
}

/**
 * Project untrusted records onto the saved schema. Never spread incoming objects:
 * API keys, headers, and unknown fields must not survive at any nesting level.
 * Known text fields are intentionally preserved and can still contain secrets.
 */
export function normalizeSavedBenchmark(value: unknown): SavedBenchmark {
  const item = object(value, "Benchmark record");
  const id = text(item.id, "id", true);
  if (id === "all") throw new Error("The id 'all' is reserved for clearing history");
  const savedAt = text(item.savedAt, "savedAt", true);
  if (!Number.isFinite(Date.parse(savedAt))) throw new Error("savedAt must be a valid date");
  const endpoint = text(item.endpoint, "endpoint", true).trim();
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("endpoint must be a valid HTTP(S) URL"); }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("endpoint must be an HTTP(S) URL without embedded credentials");
  }
  if (item.protocol !== "chat" && item.protocol !== "responses" && item.protocol !== "custom") {
    throw new Error("Invalid benchmark protocol");
  }
  if (item.promptPreset !== undefined && (typeof item.promptPreset !== "string" || !["short", "medium", "long", "custom"].includes(item.promptPreset))) {
    throw new Error("Invalid prompt preset");
  }
  const config = object(item.config, "config");
  const aggregate = object(item.aggregate, "aggregate");
  if (!Array.isArray(item.results)) throw new Error("results must be an array");
  return {
    id,
    name: optionalText(item.name, "name"),
    notes: optionalText(item.notes, "notes"),
    savedAt,
    model: text(item.model, "model", true),
    endpoint,
    protocol: item.protocol as EndpointProtocol,
    promptPreset: item.promptPreset as SavedBenchmark["promptPreset"],
    prompt: text(item.prompt, "prompt"),
    config: {
      runs: number(config.runs, "config.runs", true),
      concurrency: number(config.concurrency, "config.concurrency", true),
      maxTokens: number(config.maxTokens, "config.maxTokens", true),
      temperature: number(config.temperature, "config.temperature"),
      stream: boolean(config.stream, "config.stream", true),
      coldStart: boolean(config.coldStart, "config.coldStart", false),
    },
    aggregate: {
      ttft: distribution(aggregate.ttft, "aggregate.ttft"),
      latency: distribution(aggregate.latency, "aggregate.latency"),
      tps: distribution(aggregate.tps, "aggregate.tps"),
      tokens: distribution(aggregate.tokens, "aggregate.tokens"),
      itl: distribution(aggregate.itl, "aggregate.itl"),
      completed: number(aggregate.completed, "aggregate.completed", true),
      failed: number(aggregate.failed, "aggregate.failed", true),
    },
    results: item.results.map(runResult),
  };
}
