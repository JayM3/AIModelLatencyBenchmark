import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSavedBenchmark } from "../src/lib/saved-benchmark.ts";
import { savedBenchmark } from "./saved-benchmark-fixture.ts";

function json(value: unknown): unknown { return JSON.parse(JSON.stringify(value)); }

test("saved benchmark validation preserves legitimate benchmark fields", () => {
  const original = savedBenchmark();
  assert.deepEqual(json(normalizeSavedBenchmark(original)), json(original));
});

test("saved benchmark allowlisting strips credentials and unknown fields at every level", () => {
  const original = savedBenchmark();
  const marker = "fixture-secret-marker";
  const record = {
    ...original,
    apiKey: marker,
    headers: { Authorization: marker },
    config: { ...original.config, apiKey: marker, headers: { Authorization: marker } },
    aggregate: { ...original.aggregate, headers: marker, ttft: { ...original.aggregate.ttft, extra: marker } },
    results: original.results.map((run) => ({
      ...run,
      apiKey: marker,
      tokenEvents: run.tokenEvents?.map((event) => ({ ...event, headers: marker })),
    })),
  };
  const normalized = normalizeSavedBenchmark(record);
  assert.equal(JSON.stringify(normalized).includes(marker), false);
  assert.deepEqual(json(normalized), json(original));
  assert.equal(record.apiKey, marker, "Validation must not mutate the caller's data");
});

test("saved benchmark validation rejects malformed records and invalid field types", () => {
  for (const value of [null, [], "record", {}, { id: "id", model: "model" }]) {
    assert.throws(() => normalizeSavedBenchmark(value));
  }
  for (const patch of [
    { id: "all" }, { savedAt: "invalid" }, { protocol: "invalid" }, { promptPreset: ["short"] },
    { endpoint: "https://user:password@provider.example" }, { endpoint: "file:///tmp/data" },
    { name: 42 }, { prompt: [] }, { config: [] }, { aggregate: {} }, { results: {} },
    { results: [{ ...savedBenchmark().results[0], status: "unknown" }] },
    { results: [{ ...savedBenchmark().results[0], tokenEvents: {} }] },
  ]) {
    assert.throws(() => normalizeSavedBenchmark({ ...savedBenchmark(), ...patch }));
  }
});

test("saved benchmark validation rejects non-finite, negative, or fractional count fields", () => {
  for (const value of [NaN, Infinity, -1]) {
    const record = savedBenchmark();
    record.aggregate.ttft.mean = value;
    assert.throws(() => normalizeSavedBenchmark(record), /finite, non-negative/);
  }
  const record = savedBenchmark();
  record.config.runs = 1.5;
  assert.throws(() => normalizeSavedBenchmark(record), /integer/);
});

test("saved benchmark validation supports missing optional legacy flags", () => {
  const record = savedBenchmark();
  const { stream: _stream, coldStart: _coldStart, ...config } = record.config;
  const normalized = normalizeSavedBenchmark({ ...record, config });
  assert.equal(normalized.config.stream, true);
  assert.equal(normalized.config.coldStart, false);
});

test("saved benchmark validation returns independent nested records", () => {
  const record = savedBenchmark();
  const normalized = normalizeSavedBenchmark(record);
  normalized.config.maxTokens = 1;
  normalized.results[0]!.tokenEvents![0]!.text = "changed";
  assert.equal(record.config.maxTokens, 128);
  assert.equal(record.results[0]!.tokenEvents![0]!.text, "Hello");
});

test("saved benchmark allowlisting intentionally preserves known text fields", () => {
  const marker = "User-provided sensitive content must not be assumed redacted.";
  const record = savedBenchmark({ notes: marker, prompt: marker });
  assert.equal(normalizeSavedBenchmark(record).notes, marker);
  assert.equal(normalizeSavedBenchmark(record).prompt, marker);
});
