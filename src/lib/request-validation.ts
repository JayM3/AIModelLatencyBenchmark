import { clamp } from "./limits.ts";
import { parseHeaders } from "./benchmark-runner.ts";
import type { BenchmarkRequest, EndpointProtocol } from "./types.ts";

export type ValidatedBenchmarkRequest = BenchmarkRequest & {
  endpoint: string;
  model: string;
  prompt: string;
  protocol: EndpointProtocol;
  headers: Record<string, string>;
};

/** Validate untrusted JSON before it reaches the provider request runner. */
export function normalizeBenchmarkRequest(value: unknown): ValidatedBenchmarkRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }
  const body = value as Record<string, unknown>;
  if (typeof body.endpoint !== "string" || !body.endpoint.trim()) {
    throw new Error("Endpoint is required and must be a string");
  }
  if (typeof body.model !== "string" || !body.model.trim()) {
    throw new Error("Model is required and must be a string");
  }
  const endpoint = body.endpoint.trim();
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("Endpoint must be a valid HTTP(S) URL"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Endpoint must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("Do not embed credentials in the endpoint URL; use the API key or custom headers");
  }
  const protocol = body.protocol ?? (endpoint.replace(/\/+$/, "").endsWith("/responses") ? "responses" : "chat");
  if (protocol !== "chat" && protocol !== "responses" && protocol !== "custom") {
    throw new Error("Protocol must be chat, responses, or custom");
  }
  for (const key of ["apiKey", "prompt"] as const) {
    if (body[key] !== undefined && typeof body[key] !== "string") {
      throw new Error(key + " must be a string");
    }
  }
  for (const key of ["stream", "coldStart"] as const) {
    if (body[key] !== undefined && typeof body[key] !== "boolean") {
      throw new Error(key + " must be a boolean");
    }
  }
  for (const key of ["runs", "concurrency", "maxTokens", "temperature"] as const) {
    if (body[key] !== undefined && typeof body[key] !== "number" && typeof body[key] !== "string") {
      throw new Error(key + " must be numeric");
    }
  }
  let headers: Record<string, string>;
  try {
    headers = parseHeaders(body.headers === undefined ? "" : JSON.stringify(body.headers));
  } catch {
    throw new Error("Custom headers must be a string-to-string object");
  }
  return {
    endpoint,
    model: body.model.trim(),
    protocol,
    prompt: (body.prompt as string | undefined)?.trim() || "Say hello in one sentence.",
    apiKey: (body.apiKey as string | undefined)?.trim(),
    headers,
    runs: clamp(body.runs, "runs", 1),
    concurrency: clamp(body.concurrency, "concurrency", 1),
    maxTokens: clamp(body.maxTokens, "maxTokens", 128),
    temperature: clamp(body.temperature, "temperature", 0),
    stream: (body.stream as boolean | undefined) ?? true,
    coldStart: (body.coldStart as boolean | undefined) ?? false,
  };
}

/** Reject simple form/plain-text writes; browser clients send application/json. */
export function isJsonRequest(request: Request): boolean {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}
