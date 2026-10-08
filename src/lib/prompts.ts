import type { PromptPreset } from "./types";

export type PromptDefinition = {
  id: Exclude<PromptPreset, "custom">;
  label: string;
  descriptor: string;
  tokenEstimate: string;
  prompt: string;
};

export const promptPresets: PromptDefinition[] = [
  {
    id: "short",
    label: "Quick pulse",
    descriptor: "Short latency check",
    tokenEstimate: "~30 tokens",
    prompt: "In three concise bullet points, explain what makes an AI model benchmark reliable.",
  },
  {
    id: "medium",
    label: "Production chat",
    descriptor: "Balanced instruction",
    tokenEstimate: "~70 tokens",
    prompt: "You are a performance engineer. Explain the trade-offs between TTFT, end-to-end latency, and tokens per second for a production chat application. Include practical recommendations for evaluating a new model.",
  },
  {
    id: "long",
    label: "Prefill stress",
    descriptor: "Long-context pressure",
    tokenEstimate: "~140 tokens",
    prompt: "You are reviewing an AI inference service for a production team. Analyze how network distance, prompt length, model size, quantization, batching, streaming protocol, and hardware utilization influence TTFT, end-to-end latency, and tokens per second. Provide a clear testing methodology and call out misleading benchmark practices.",
  },
];

export const promptById = Object.fromEntries(promptPresets.map((preset) => [preset.id, preset.prompt])) as Record<Exclude<PromptPreset, "custom">, string>;
