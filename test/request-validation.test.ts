import assert from "node:assert/strict";
import test from "node:test";
import { isJsonRequest, normalizeBenchmarkRequest } from "../src/lib/request-validation.ts";

const base = { endpoint: "https://provider.example/v1", model: "test-model" };

test("benchmark validation supplies safe defaults and trims string inputs", () => {
  const request = normalizeBenchmarkRequest({ endpoint: "  http://localhost:8000/v1  ", model: " test-model ", apiKey: " dummy-key " });
  assert.equal(request.endpoint, "http://localhost:8000/v1");
  assert.equal(request.model, "test-model");
  assert.equal(request.apiKey, "dummy-key");
  assert.equal(request.protocol, "chat");
  assert.equal(request.prompt, "Say hello in one sentence.");
  assert.equal(request.runs, 1);
  assert.equal(request.maxTokens, 128);
  assert.equal(request.temperature, 0);
  assert.equal(request.stream, true);
  assert.equal(request.coldStart, false);
  assert.deepEqual(request.headers, {});
});

test("benchmark validation rejects non-object request bodies", () => {
  for (const body of [null, undefined, [], "hello", 42, true]) {
    assert.throws(() => normalizeBenchmarkRequest(body), /JSON object/);
  }
});

test("benchmark validation rejects missing or wrongly typed endpoint/model values", () => {
  for (const body of [{}, { ...base, endpoint: 42 }, { ...base, endpoint: " " }, { ...base, model: [] }, { ...base, model: "" }]) {
    assert.throws(() => normalizeBenchmarkRequest(body), /Endpoint|Model/);
  }
});

test("benchmark validation accepts HTTP(S) but rejects unsafe schemes and URL credentials", () => {
  for (const endpoint of ["not a URL", "file:///etc/passwd", "ftp://provider.example", "https://user:password@provider.example/v1"]) {
    assert.throws(() => normalizeBenchmarkRequest({ ...base, endpoint }), /HTTP|credentials/);
  }
  assert.equal(normalizeBenchmarkRequest({ ...base, endpoint: "http://[::1]:8000/v1" }).endpoint, "http://[::1]:8000/v1");
});

test("benchmark validation infers Responses routes and validates explicit protocols", () => {
  assert.equal(normalizeBenchmarkRequest({ ...base, endpoint: base.endpoint + "/responses/" }).protocol, "responses");
  assert.equal(normalizeBenchmarkRequest({ ...base, protocol: "custom" }).protocol, "custom");
  for (const protocol of ["invalid", 123, [], {}]) {
    assert.throws(() => normalizeBenchmarkRequest({ ...base, protocol }), /Protocol/);
  }
});

test("benchmark validation enforces string, boolean, and numeric option types", () => {
  for (const patch of [{ apiKey: {} }, { prompt: [] }, { stream: "false" }, { coldStart: 1 }, { runs: [] }, { temperature: null }]) {
    assert.throws(() => normalizeBenchmarkRequest({ ...base, ...patch }), /must be/);
  }
});

test("benchmark validation accepts only a flat string header map", () => {
  assert.deepEqual(normalizeBenchmarkRequest({ ...base, headers: { "X-Test": "dummy" } }).headers, { "X-Test": "dummy" });
  for (const headers of [null, [], "{}", { test: 42 }, { test: {} }]) {
    assert.throws(() => normalizeBenchmarkRequest({ ...base, headers }), /string-to-string/);
  }
});

test("benchmark validation normalizes request bounds and preserves zero temperature", () => {
  const request = normalizeBenchmarkRequest({ ...base, runs: "3.9", concurrency: 99, maxTokens: -1, temperature: 0, stream: false });
  assert.equal(request.runs, 3);
  assert.equal(request.concurrency, 5);
  assert.equal(request.maxTokens, 1);
  assert.equal(request.temperature, 0);
  assert.equal(request.stream, false);
});

test("benchmark validation does not forward unknown request fields", () => {
  const request = normalizeBenchmarkRequest({ ...base, unexpected: "private marker" });
  assert.equal("unexpected" in request, false);
});

test("write requests accept JSON media types and reject simple cross-origin form types", () => {
  for (const type of ["application/json", "application/json; charset=utf-8", "Application/JSON"]) {
    assert.equal(isJsonRequest(new Request("http://localhost/api/benchmark", { headers: { "Content-Type": type } })), true);
  }
  for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", "application/jsonp"]) {
    assert.equal(isJsonRequest(new Request("http://localhost/api/benchmark", { headers: { "Content-Type": type } })), false);
  }
  assert.equal(isJsonRequest(new Request("http://localhost/api/benchmark")), false);
});
