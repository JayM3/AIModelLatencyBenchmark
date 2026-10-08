import type { EndpointProtocol } from "./types";

export type ProviderPreset = {
  id: string;
  name: string;
  category: "Cloud" | "Local";
  endpoint: string;
  protocol: EndpointProtocol;
  model: string;
  hint: string;
};

export const providerPresets: ProviderPreset[] = [
  { id: "openai", name: "OpenAI", category: "Cloud", endpoint: "https://api.openai.com/v1", protocol: "chat", model: "gpt-4o-mini", hint: "OpenAI-compatible" },
  { id: "groq", name: "Groq", category: "Cloud", endpoint: "https://api.groq.com/openai/v1", protocol: "chat", model: "llama-3.3-70b-versatile", hint: "OpenAI-compatible" },
  { id: "openrouter", name: "OpenRouter", category: "Cloud", endpoint: "https://openrouter.ai/api/v1", protocol: "chat", model: "openai/gpt-4o-mini", hint: "OpenAI-compatible" },
  { id: "vllm", name: "vLLM", category: "Local", endpoint: "http://localhost:8000/v1", protocol: "chat", model: "your-model", hint: "Local server" },
  { id: "ollama", name: "Ollama", category: "Local", endpoint: "http://localhost:11434/v1", protocol: "chat", model: "llama3.2", hint: "OpenAI-compatible" },
  { id: "lmstudio", name: "LM Studio", category: "Local", endpoint: "http://localhost:1234/v1", protocol: "chat", model: "local-model", hint: "Local server" },
  { id: "custom", name: "Custom gateway", category: "Cloud", endpoint: "https://your-endpoint.example/v1", protocol: "custom", model: "your-model", hint: "Bring your route" },
];
