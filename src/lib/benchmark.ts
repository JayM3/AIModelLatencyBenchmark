import { clamp } from "./limits.ts";
import { executeRun } from "./benchmark-runner.ts";
import { aggregateRuns } from "./metrics.ts";
import type { BenchmarkRequest, BenchmarkResponse, EndpointProtocol, RunResult } from "./types.ts";

export { clamp, LIMITS } from "./limits.ts";

export type BenchmarkEvent =
  | { type: "meta"; total: number; model: string; endpoint: string; protocol: EndpointProtocol }
  | { type: "run"; result: RunResult; completed: number; total: number }
  | { type: "done"; response: BenchmarkResponse };

export type RunBenchmarkOptions = BenchmarkRequest & {
  endpoint: string;
  model: string;
  prompt: string;
  protocol: EndpointProtocol;
  onEvent?: (event: BenchmarkEvent) => void;
  signal?: AbortSignal;
};

/** Run bounded batches and emit progress for the web API's event stream. */
export async function runBenchmark(options: RunBenchmarkOptions): Promise<BenchmarkResponse> {
  const runs = clamp(options.runs, "runs", 1);
  const concurrency = clamp(options.concurrency, "concurrency", 1);
  const request = {
    endpoint: options.endpoint,
    apiKey: options.apiKey,
    model: options.model,
    prompt: options.prompt,
    protocol: options.protocol,
    maxTokens: clamp(options.maxTokens, "maxTokens", 128),
    temperature: clamp(options.temperature, "temperature", 0),
    stream: options.stream,
    headers: options.headers,
    signal: options.signal,
  };
  const results: RunResult[] = [];

  options.signal?.throwIfAborted();
  options.onEvent?.({ type: "meta", total: runs, model: options.model, endpoint: options.endpoint, protocol: options.protocol });

  for (let offset = 0; offset < runs; offset += concurrency) {
    options.signal?.throwIfAborted();
    const batch = Array.from({ length: Math.min(concurrency, runs - offset) }, (_, index) =>
      executeRun({ ...request, run: offset + index + 1 }).then((result) => {
        options.signal?.throwIfAborted();
        results.push(result);
        options.onEvent?.({ type: "run", result, completed: results.length, total: runs });
      }),
    );
    await Promise.all(batch);
  }

  options.signal?.throwIfAborted();
  const response: BenchmarkResponse = {
    results,
    aggregate: aggregateRuns(results),
    model: options.model,
    endpoint: options.endpoint,
    protocol: options.protocol,
    completedAt: new Date().toISOString(),
  };
  options.onEvent?.({ type: "done", response });
  return response;
}
