import { aggregateRuns } from "../src/lib/metrics.ts";
import type { SavedBenchmark } from "../src/lib/types.ts";
import { runResult } from "./support.ts";

export function savedBenchmark(overrides: Partial<SavedBenchmark> = {}): SavedBenchmark {
  const results = [runResult({
    output: "Hello from a mock provider.",
    tokenEvents: [{ index: 1, atMs: 400, deltaMs: 0, text: "Hello" }],
  })];
  return {
    id: "fixture-benchmark",
    name: "Synthetic benchmark",
    notes: "Dummy data only.",
    savedAt: "2026-01-01T12:00:00.000Z",
    model: "test-model",
    endpoint: "http://127.0.0.1:8000/v1",
    protocol: "chat",
    promptPreset: "custom",
    prompt: "Say hello.",
    config: { runs: 1, concurrency: 1, maxTokens: 128, temperature: 0, stream: true, coldStart: false },
    aggregate: aggregateRuns(results),
    results,
    ...overrides,
  };
}
