export type EndpointProtocol = "responses" | "chat" | "custom";

export type PromptPreset = "short" | "medium" | "long" | "custom";

export type TokenEvent = {
  index: number;
  atMs: number;
  deltaMs: number;
  text?: string;
};

export type RunStatus = "pending" | "ready" | "error";

export type RunResult = {
  run: number;
  ttft: number;
  latency: number;
  tps: number;
  tokens: number;
  status: RunStatus;
  output?: string;
  error?: string;
  tokenEvents?: TokenEvent[];
};

export type Distribution = {
  mean: number;
  median: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
  stdev: number;
};

export type AggregatedMetrics = {
  ttft: Distribution;
  latency: Distribution;
  tps: Distribution;
  tokens: Distribution;
  itl: Distribution;
  completed: number;
  failed: number;
};

export type BenchmarkRequest = {
  endpoint?: string;
  apiKey?: string;
  model?: string;
  protocol?: EndpointProtocol;
  runs?: number;
  concurrency?: number;
  prompt?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  headers?: Record<string, string>;
  coldStart?: boolean;
};

export type BenchmarkResponse = {
  results: RunResult[];
  aggregate: AggregatedMetrics;
  model: string;
  endpoint: string;
  protocol: EndpointProtocol;
  completedAt: string;
};

export type SavedBenchmark = {
  id: string;
  name?: string;
  notes?: string;
  savedAt: string;
  model: string;
  endpoint: string;
  protocol: EndpointProtocol;
  promptPreset?: PromptPreset;
  prompt: string;
  config: {
    runs: number;
    concurrency: number;
    maxTokens: number;
    temperature: number;
    stream: boolean;
    coldStart: boolean;
  };
  aggregate: AggregatedMetrics;
  results: RunResult[];
};
