import assert from "node:assert/strict";
import test from "node:test";
import { aggregateRuns, distribution, interTokenLatencies, percentile } from "../src/lib/metrics.ts";
import { runResult } from "./support.ts";

test("percentile returns 0 for an empty set and the value itself for a single sample", () => {
  assert.equal(percentile([], 0.5), 0);
  assert.equal(percentile([17], 0), 17);
  assert.equal(percentile([17], 0.95), 17);
});

test("percentile interpolates linearly between neighbours", () => {
  assert.equal(percentile([10, 20], 0.5), 15);
  assert.equal(percentile([10, 20], 0), 10);
  assert.equal(percentile([10, 20], 1), 20);
  // (4 - 1) * 0.95 = 2.85 -> between 30 and 40 at 85%
  assert.equal(percentile([10, 20, 30, 40], 0.95), 38.5);
});

test("percentile does not mutate its input", () => {
  const values = [3, 1, 2];
  percentile(values, 0.5);
  assert.deepEqual(values, [3, 1, 2]);
});

test("distribution of an empty set is a well-formed zero object", () => {
  assert.deepEqual(distribution([]), { mean: 0, median: 0, p50: 0, p95: 0, min: 0, max: 0, stdev: 0 });
});

test("distribution reports population stdev and rounds to 2 decimals", () => {
  const result = distribution([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(result.mean, 5);
  assert.equal(result.median, 4.5);
  assert.equal(result.p50, 4.5);
  assert.equal(result.min, 2);
  assert.equal(result.max, 9);
  assert.equal(result.stdev, 2);
  assert.equal(distribution([1, 2, 4]).mean, 2.33);
});

test("interTokenLatencies drops non-positive deltas (the first token has no predecessor)", () => {
  const events = [
    { index: 1, atMs: 10, deltaMs: 0 },
    { index: 2, atMs: 30, deltaMs: 20 },
    { index: 3, atMs: 45, deltaMs: 15 },
    { index: 4, atMs: 45, deltaMs: 0 },
  ];
  assert.deepEqual(interTokenLatencies(events), [20, 15]);
  assert.deepEqual(interTokenLatencies(undefined), []);
  assert.deepEqual(interTokenLatencies([]), []);
});

test("aggregateRuns over zero runs mirrors an empty distribution", () => {
  const aggregate = aggregateRuns([]);
  assert.equal(aggregate.completed, 0);
  assert.equal(aggregate.failed, 0);
  assert.equal(aggregate.ttft.p50, 0);
  assert.equal(aggregate.itl.p50, 0);
});

test("aggregateRuns counts failures but excludes them from every distribution", () => {
  const results = [
    runResult({ run: 1, ttft: 400, latency: 2000, tps: 40, tokens: 200 }),
    runResult({ run: 2, ttft: 1000, latency: 9000, tps: 0, tokens: 0, status: "error", error: "boom" }),
    runResult({ run: 3, ttft: 500, latency: 2100, tps: 30, tokens: 100 }),
  ];
  const aggregate = aggregateRuns(results);
  assert.equal(aggregate.completed, 2);
  assert.equal(aggregate.failed, 1);
  // The error run's ttft of 1000 must not leak into the distribution.
  assert.equal(aggregate.ttft.max, 500);
  assert.equal(aggregate.latency.max, 2100);
  assert.equal(aggregate.tps.min, 30);
  assert.equal(aggregate.tokens.mean, 150);
});

test("aggregateRuns pools inter-token latencies across runs", () => {
  const results = [
    runResult({ run: 1, tokenEvents: [{ index: 1, atMs: 1, deltaMs: 0 }, { index: 2, atMs: 11, deltaMs: 10 }] }),
    runResult({ run: 2, tokenEvents: [{ index: 1, atMs: 1, deltaMs: 0 }, { index: 2, atMs: 31, deltaMs: 30 }] }),
  ];
  const aggregate = aggregateRuns(results);
  assert.equal(aggregate.itl.min, 10);
  assert.equal(aggregate.itl.max, 30);
  assert.equal(aggregate.itl.mean, 20);
});

test("aggregateRuns treats every run as failed when none is ready", () => {
  const aggregate = aggregateRuns([
    runResult({ run: 1, status: "error", error: "a" }),
    runResult({ run: 2, status: "pending" }),
  ]);
  assert.equal(aggregate.completed, 0);
  assert.equal(aggregate.failed, 2);
  assert.equal(aggregate.ttft.p95, 0);
});


test("distribution does not mutate its input and handles a large token sample", () => {
  const values = [9, 1, 4, 2];
  distribution(values);
  assert.deepEqual(values, [9, 1, 4, 2]);

  const large = Array.from({ length: 200_000 }, (_, index) => index);
  const result = distribution(large);
  assert.equal(result.min, 0);
  assert.equal(result.max, 199_999);
  assert.equal(result.median, 99_999.5);
  assert.equal(result.p50, result.median);
  assert.equal(result.p95, 189_999.05);
});
