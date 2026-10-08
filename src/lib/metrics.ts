import type { AggregatedMetrics, Distribution, RunResult, TokenEvent } from "./types";

const round = (value: number, digits = 2) => Number(value.toFixed(digits));

function sortedPercentile(sorted: number[], percentileValue: number) {
  const index = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function percentile(values: number[], percentileValue: number) {
  if (!values.length) return 0;
  return sortedPercentile([...values].sort((a, b) => a - b), percentileValue);
}

export function distribution(values: number[]): Distribution {
  if (!values.length) return { mean: 0, median: 0, p50: 0, p95: 0, min: 0, max: 0, stdev: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const median = round(sortedPercentile(sorted, 0.5));
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return {
    mean: round(mean),
    median,
    p50: median,
    p95: round(sortedPercentile(sorted, 0.95)),
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    stdev: round(Math.sqrt(variance)),
  };
}

export function interTokenLatencies(events: TokenEvent[] = []) {
  return events.filter((event) => event.deltaMs > 0).map((event) => event.deltaMs);
}

export function aggregateRuns(results: RunResult[]): AggregatedMetrics {
  const completed = results.filter((result) => result.status === "ready");
  const itl = completed.flatMap((result) => interTokenLatencies(result.tokenEvents));
  return {
    ttft: distribution(completed.map((result) => result.ttft)),
    latency: distribution(completed.map((result) => result.latency)),
    tps: distribution(completed.map((result) => result.tps)),
    tokens: distribution(completed.map((result) => result.tokens)),
    itl: distribution(itl),
    completed: completed.length,
    failed: results.length - completed.length,
  };
}
