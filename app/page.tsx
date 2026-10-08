"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  Check,
  Download,
  Eye,
  FileJson,
  Gauge,
  GitCompare,
  History,
  KeyRound,
  Play,
  RotateCcw,
  Settings2,
  SlidersHorizontal,
  Timer,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import packageInfo from "@/package.json";
import { clamp } from "@/src/lib/limits";
import { aggregateRuns } from "@/src/lib/metrics";
import { promptById, promptPresets } from "@/src/lib/prompts";
import { providerPresets } from "@/src/lib/providers";
import {
  fetchHistory,
  formatHistoryDate,
  formatRelativeTime,
  persistBenchmark,
  removeBenchmark,
} from "@/src/lib/history";
import type {
  AggregatedMetrics,
  BenchmarkResponse,
  EndpointProtocol,
  PromptPreset,
  RunResult,
  SavedBenchmark,
} from "@/src/lib/types";

const seedRuns: RunResult[] = [];

const initialAggregate = aggregateRuns(seedRuns);

function display(value: number, unit = "", digits = 0) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}${unit}`;
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function buildCsv(results: RunResult[]) {
  const header = "Run,TTFT (ms),E2E Latency (ms),TPS,Tokens,Status,Error";
  const rows = results.map((run) =>
    [
      run.run,
      run.ttft.toFixed(2),
      run.latency.toFixed(2),
      run.tps.toFixed(2),
      run.tokens,
      run.status,
      run.error ?? "",
    ]
      .map(csvCell)
      .join(",")
  );
  return [header, ...rows].join("\n");
}

export default function Home() {
  const [providerId, setProviderId] = useState("openai");
  const [endpoint, setEndpoint] = useState("https://api.openai.com/v1");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [protocol, setProtocol] = useState<EndpointProtocol>("responses");
  const [customHeaders, setCustomHeaders] = useState("");
  const [headersOpen, setHeadersOpen] = useState(false);
  const [runs, setRuns] = useState("8");
  const [concurrency, setConcurrency] = useState("1");
  const [promptPreset, setPromptPreset] = useState<PromptPreset>("medium");
  const [customPrompt, setCustomPrompt] = useState("");
  const [maxTokens, setMaxTokens] = useState("128");
  const [temperature, setTemperature] = useState("0.2");
  const [stream, setStream] = useState(true);
  const [coldStart, setColdStart] = useState(true);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [result, setResult] = useState<BenchmarkResponse>({
    results: seedRuns,
    aggregate: initialAggregate,
    model: "gpt-4o-mini",
    endpoint: "https://api.openai.com/v1",
    protocol: "responses",
    completedAt: new Date().toISOString(),
  });
  const [activeView, setActiveView] = useState<"overview" | "timing" | "tokens">("overview");
  const [selectedRun, setSelectedRun] = useState<RunResult | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Saved benchmark history state
  const [history, setHistory] = useState<SavedBenchmark[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [isCurrentSaved, setIsCurrentSaved] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveNotes, setSaveNotes] = useState("");
  const [selectedSavedRun, setSelectedSavedRun] = useState<SavedBenchmark | null>(null);
  const [loadedSavedRun, setLoadedSavedRun] = useState<SavedBenchmark | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const toastTimeoutRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const metrics = result.aggregate;
  const chartMax = Math.max(...result.results.map((run) => run.latency), 2000);
  const prompt = promptPreset === "custom" ? customPrompt : promptById[promptPreset];
  const selectedPreset = providerPresets.find((preset) => preset.id === providerId);

  // Load history on mount
  useEffect(() => {
    let mounted = true;
    fetchHistory()
      .then((data) => {
        if (mounted) {
          setHistory(data);
          setLoadingHistory(false);
        }
      })
      .catch(() => {
        if (mounted) setLoadingHistory(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  function showToast(message: string) {
    setToast(message);
    if (toastTimeoutRef.current) window.clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = window.setTimeout(() => setToast(null), 3500);
  }

  function applyProvider(id: string) {
    const preset = providerPresets.find((item) => item.id === id);
    if (!preset) return;
    setProviderId(id);
    setEndpoint(preset.endpoint);
    setProtocol(preset.protocol);
    setModel(preset.model);
  }

  async function startBenchmark() {
    setRunning(true);
    setRunError("");
    setSelectedRun(null);
    setLoadedSavedRun(null);
    setIsCurrentSaved(false);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let headers: Record<string, string> = {};
      if (customHeaders.trim()) {
        try {
          headers = JSON.parse(customHeaders) as Record<string, string>;
        } catch {
          throw new Error("Custom headers must be valid JSON");
        }
      }
      if (!prompt.trim()) throw new Error("Add a prompt before starting the benchmark");
      const response = await fetch("/api/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          endpoint,
          apiKey,
          model,
          protocol,
          runs: Number(runs),
          concurrency: Number(concurrency),
          prompt,
          maxTokens: Number(maxTokens),
          temperature: Number(temperature),
          stream,
          coldStart,
          headers,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Benchmark failed" }));
        throw new Error(payload.error || "Benchmark failed");
      }
      if (!response.body) throw new Error("Benchmark stream was empty");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const currentRuns: RunResult[] = [];
      for (;;) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let event: {
            type: string;
            result?: RunResult;
            results?: RunResult[];
            aggregate?: AggregatedMetrics;
            completedAt?: string;
            error?: string;
          };
          try {
            event = JSON.parse(payload) as typeof event;
          } catch {
            continue;
          }
          if (event.type === "meta") {
            setResult((previous) => ({
              ...previous,
              results: [],
              aggregate: aggregateRuns([]),
              model,
              endpoint,
              protocol,
              completedAt: new Date().toISOString(),
            }));
          } else if (event.type === "run" && event.result) {
            currentRuns.push(event.result);
            setResult((previous) => ({
              ...previous,
              results: [...currentRuns],
              aggregate: aggregateRuns(currentRuns),
              model,
              endpoint,
              protocol,
              completedAt: new Date().toISOString(),
            }));
          } else if (event.type === "done") {
            const finalRuns = event.results ?? currentRuns;
            setResult((previous) => ({
              ...previous,
              results: finalRuns,
              aggregate: event.aggregate ?? aggregateRuns(finalRuns),
              model,
              endpoint,
              protocol,
              completedAt: event.completedAt ?? new Date().toISOString(),
            }));
          } else if (event.type === "error") {
            throw new Error(event.error || "Benchmark failed");
          }
        }
        if (chunk.done) {
          if (buffer.trim().startsWith("data:")) {
            const payload = buffer.trim().slice(5).trim();
            if (payload) {
              try {
                const event = JSON.parse(payload) as {
                  type: string;
                  result?: RunResult;
                  results?: RunResult[];
                  aggregate?: AggregatedMetrics;
                  completedAt?: string;
                  error?: string;
                };
                if (event.type === "run" && event.result) {
                  currentRuns.push(event.result);
                  setResult((previous) => ({
                    ...previous,
                    results: [...currentRuns],
                    aggregate: aggregateRuns(currentRuns),
                    model,
                    endpoint,
                    protocol,
                    completedAt: new Date().toISOString(),
                  }));
                } else if (event.type === "done") {
                  const finalRuns = event.results ?? currentRuns;
                  setResult((previous) => ({
                    ...previous,
                    results: finalRuns,
                    aggregate: event.aggregate ?? aggregateRuns(finalRuns),
                    model,
                    endpoint,
                    protocol,
                    completedAt: event.completedAt ?? new Date().toISOString(),
                  }));
                }
              } catch {
                /* Ignore a malformed trailing frame. */
              }
            }
          }
          break;
        }
      }
      setActiveView("overview");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        setRunError("Benchmark cancelled");
      else setRunError(error instanceof Error ? error.message : "Unable to run benchmark");
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }

  function cancelBenchmark() {
    abortRef.current?.abort();
  }

  function exportResults(format: "json" | "csv") {
    const body =
      format === "json"
        ? JSON.stringify(
            {
              ...result,
              config: {
                endpoint,
                model,
                protocol,
                runs,
                concurrency,
                promptPreset,
                maxTokens,
                temperature,
              },
            },
            null,
            2
          )
        : buildCsv(result.results);
    const blob = new Blob([body], {
      type: format === "json" ? "application/json" : "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `benchroom-${model.replace(/[^a-z0-9]+/gi, "-")}-${Date.now()}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openSaveModal() {
    if (!result.results.length || running) return;
    setSaveName(`${model} (${result.results.length} runs)`);
    setSaveNotes("");
    setSaveModalOpen(true);
  }

  async function handleSaveBenchmark() {
    if (!result.results.length) return;
    const item: SavedBenchmark = {
      id: `bench_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: saveName.trim() || `${model} (${result.results.length} runs)`,
      notes: saveNotes.trim() || undefined,
      savedAt: new Date().toISOString(),
      model,
      endpoint,
      protocol,
      promptPreset,
      prompt,
      config: {
        runs: clamp(runs, "runs", 1),
        concurrency: clamp(concurrency, "concurrency", 1),
        maxTokens: clamp(maxTokens, "maxTokens", 128),
        temperature: clamp(temperature, "temperature", 0),
        stream,
        coldStart,
      },
      aggregate: result.aggregate,
      results: result.results,
    };

    const updated = await persistBenchmark(item);
    setHistory(updated);
    setIsCurrentSaved(true);
    setSaveModalOpen(false);
    showToast("Benchmark run saved internally to history!");
  }

  function loadSavedBenchmark(item: SavedBenchmark) {
    setResult({
      results: item.results,
      aggregate: item.aggregate,
      model: item.model,
      endpoint: item.endpoint,
      protocol: item.protocol,
      completedAt: item.savedAt,
    });
    setModel(item.model);
    setEndpoint(item.endpoint);
    setProtocol(item.protocol);
    if (item.promptPreset) setPromptPreset(item.promptPreset);
    if (item.promptPreset === "custom") setCustomPrompt(item.prompt);
    setRuns(String(item.config.runs));
    setConcurrency(String(item.config.concurrency));
    setMaxTokens(String(item.config.maxTokens));
    setTemperature(String(item.config.temperature));
    setStream(item.config.stream);
    setColdStart(item.config.coldStart);
    setLoadedSavedRun(item);
    setIsCurrentSaved(true);
    setSelectedSavedRun(null);
    showToast(`Loaded "${item.name || item.model}" into dashboard!`);
    const el = document.getElementById("benchmark");
    el?.scrollIntoView({ behavior: "smooth" });
  }

  async function handleDeleteSavedRun(id: string, event?: React.MouseEvent) {
    event?.stopPropagation();
    if (!window.confirm("Delete this saved benchmark run from history?")) return;
    const updated = await removeBenchmark(id);
    setHistory(updated);
    if (selectedSavedRun?.id === id) setSelectedSavedRun(null);
    if (loadedSavedRun?.id === id) setLoadedSavedRun(null);
    showToast("Benchmark run removed from history.");
  }

  async function handleClearAllHistory() {
    if (!window.confirm("Clear all saved benchmark history? This cannot be undone.")) return;
    const updated = await removeBenchmark("all");
    setHistory(updated);
    if (loadedSavedRun) setLoadedSavedRun(null);
    showToast("All saved benchmark history cleared.");
  }

  function exportSavedRun(item: SavedBenchmark, event?: React.MouseEvent) {
    event?.stopPropagation();
    const body = JSON.stringify(item, null, 2);
    const blob = new Blob([body], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `benchroom-saved-${item.model.replace(/[^a-z0-9]+/gi, "-")}-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">⌁</span>
          <span>benchroom</span>
          <span className="brand-version">v{packageInfo.version}</span>
        </div>
        <nav className="nav-links" aria-label="Primary">
          <a href="#benchmark">Benchmark</a>
          <a href="#history">History</a>
          <a href="#docs">Docs</a>
        </nav>
        <div className="header-actions">
          <span className="status">
            <i className="status-dot" /> Backend ready
          </span>
          <button
            className="icon-btn"
            aria-label="Workspace settings"
            onClick={() => setShowSettings(true)}
          >
            <Settings2 size={16} />
          </button>
          <span className="avatar" aria-label="Account" />
        </div>
      </header>

      <main className="content" id="benchmark">
        <div className="page-heading">
          <div>
            <div className="kicker">Inference performance lab</div>
            <h1>Model benchmark</h1>
            <p className="subheading">Measure streaming performance before it reaches production.</p>
          </div>
          <div className="heading-actions">
            <button
              className={`outline-button ${isCurrentSaved ? "save-btn-primary saved" : ""}`}
              onClick={openSaveModal}
              disabled={!result.results.length || running}
              title={
                result.results.length
                  ? "Save this benchmark run internally"
                  : "Run a benchmark to save results"
              }
            >
              {isCurrentSaved ? <Check size={14} /> : <Bookmark size={14} />}
              {isCurrentSaved ? "Saved internally" : "Save result"}
            </button>
            <button className="outline-button" onClick={() => exportResults("json")}>
              <FileJson size={14} /> Export JSON
            </button>
            <div className="live-chip">● &nbsp; SERVER-SIDE RUNNER</div>
          </div>
        </div>

        <div className="workspace">
          <aside className="panel config-panel">
            <div className="panel-header">
              <span className="panel-title">Benchmark setup</span>
              <span className="panel-code">01 / 03</span>
            </div>
            <div className="config-body">
              <div className="section-label">Provider preset</div>
              <div className="provider-grid">
                {providerPresets.map((preset) => (
                  <button
                    key={preset.id}
                    className={`provider-card ${providerId === preset.id ? "selected" : ""}`}
                    onClick={() => applyProvider(preset.id)}
                  >
                    <span className="provider-name">{preset.name}</span>
                    <span className="provider-hint">{preset.hint}</span>
                  </button>
                ))}
              </div>
              <div className="field">
                <label htmlFor="endpoint">Base endpoint</label>
                <input
                  id="endpoint"
                  className="input"
                  value={endpoint}
                  onChange={(event) => {
                    setEndpoint(event.target.value);
                    setProviderId("custom");
                  }}
                />
              </div>
              <div className="split-fields">
                <div className="field">
                  <label htmlFor="protocol">Protocol</label>
                  <select
                    id="protocol"
                    className="select"
                    value={protocol}
                    onChange={(event) => setProtocol(event.target.value as EndpointProtocol)}
                  >
                    <option value="responses">Responses</option>
                    <option value="chat">Chat completions</option>
                    <option value="custom">Custom payload</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="model">Model ID</label>
                  <input
                    id="model"
                    className="input"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="apiKey">
                  <KeyRound size={11} /> API key
                </label>
                <input
                  id="apiKey"
                  className="input"
                  type="password"
                  placeholder={
                    selectedPreset?.category === "Local" ? "Optional for local" : "sk-..."
                  }
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </div>
              <button
                className="advanced-toggle"
                onClick={() => setHeadersOpen((open) => !open)}
              >
                <SlidersHorizontal size={12} /> {headersOpen ? "Hide" : "Add"} custom headers{" "}
                <span>{headersOpen ? "−" : "+"}</span>
              </button>
              {headersOpen && (
                <div className="field">
                  <label htmlFor="headers">Headers JSON</label>
                  <textarea
                    id="headers"
                    className="textarea compact"
                    placeholder={'{"X-Project": "benchroom"}'}
                    value={customHeaders}
                    onChange={(event) => setCustomHeaders(event.target.value)}
                  />
                </div>
              )}

              <div className="section-divider" />
              <div className="section-label">Run settings</div>
              <div className="split-fields">
                <div className="field">
                  <label htmlFor="runs">Runs</label>
                  <select
                    id="runs"
                    className="select"
                    value={runs}
                    onChange={(event) => setRuns(event.target.value)}
                  >
                    <option value="1">1 run</option>
                    <option value="3">3 runs</option>
                    <option value="5">5 runs</option>
                    <option value="8">8 runs</option>
                    <option value="10">10 runs</option>
                    <option value="20">20 runs</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="concurrency">Concurrency</label>
                  <select
                    id="concurrency"
                    className="select"
                    value={concurrency}
                    onChange={(event) => setConcurrency(event.target.value)}
                  >
                    <option value="1">Sequential</option>
                    <option value="2">2 parallel</option>
                    <option value="3">3 parallel</option>
                    <option value="5">5 parallel</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="promptPreset">Prompt profile</label>
                <select
                  id="promptPreset"
                  className="select"
                  value={promptPreset}
                  onChange={(event) => setPromptPreset(event.target.value as PromptPreset)}
                >
                  {promptPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label} · {preset.tokenEstimate}
                    </option>
                  ))}
                  <option value="custom">Custom prompt</option>
                </select>
              </div>
              {promptPreset === "custom" ? (
                <div className="field">
                  <label htmlFor="customPrompt">Prompt</label>
                  <textarea
                    id="customPrompt"
                    className="textarea"
                    placeholder="Write the exact prompt to benchmark..."
                    value={customPrompt}
                    onChange={(event) => setCustomPrompt(event.target.value)}
                  />
                </div>
              ) : (
                <div className="prompt-preview">{prompt}</div>
              )}
              <div className="split-fields">
                <div className="field">
                  <label htmlFor="maxTokens">Max output tokens</label>
                  <input
                    id="maxTokens"
                    className="input"
                    type="number"
                    min="1"
                    max="4096"
                    value={maxTokens}
                    onChange={(event) => setMaxTokens(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="temperature">
                    Temperature <b>{temperature}</b>
                  </label>
                  <input
                    id="temperature"
                    className="range"
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={temperature}
                    onChange={(event) => setTemperature(event.target.value)}
                  />
                </div>
              </div>
              <div className="checks">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={stream}
                    onChange={(event) => setStream(event.target.checked)}
                  />{" "}
                  Stream chunks
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={coldStart}
                    onChange={(event) => setColdStart(event.target.checked)}
                  />{" "}
                  Mark cold start
                </label>
              </div>
              <button
                className={`run-button ${running ? "running" : ""}`}
                onClick={running ? cancelBenchmark : startBenchmark}
                disabled={false}
              >
                {running ? (
                  <>
                    <span className="button-pulse" /> CANCEL BENCHMARK
                  </>
                ) : (
                  <>
                    <Play size={14} fill="currentColor" /> RUN BENCHMARK
                  </>
                )}
              </button>
              <div className="helper">Server-side proxy · keys stay on this machine</div>
              {runError && <div className="error-box">{runError}</div>}
            </div>
          </aside>

          <section className="results" aria-live="polite">
            {loadedSavedRun && (
              <div className="banner-loaded">
                <div className="banner-loaded-info">
                  <History size={14} className="title-icon" />
                  <span>
                    Viewing saved run: <b>{loadedSavedRun.name || loadedSavedRun.model}</b> (saved{" "}
                    {formatHistoryDate(loadedSavedRun.savedAt)})
                  </span>
                  {loadedSavedRun.notes && (
                    <span className="badge-tag">Note: {loadedSavedRun.notes}</span>
                  )}
                </div>
                <button className="action-chip-btn" onClick={() => setLoadedSavedRun(null)}>
                  Dismiss banner
                </button>
              </div>
            )}

            <div className="metric-grid">
              <Metric
                icon={<Timer size={15} />}
                label="TTFT"
                value={metrics.completed ? display(metrics.ttft.mean, " ms") : "—"}
                sub={
                  metrics.completed
                    ? `P95 ${display(metrics.ttft.p95, " ms")} · ±${display(metrics.ttft.stdev, " ms")}`
                    : "Run a benchmark to measure"
                }
                tone="orange"
              />
              <Metric
                icon={<Gauge size={15} />}
                label="E2E LATENCY"
                value={metrics.completed ? display(metrics.latency.mean / 1000, " s", 2) : "—"}
                sub={
                  metrics.completed
                    ? `P95 ${display(metrics.latency.p95 / 1000, " s", 2)} · ±${display(metrics.latency.stdev, " ms")}`
                    : "Run a benchmark to measure"
                }
                tone="blue"
              />
              <Metric
                icon={<Zap size={15} />}
                label="TOKENS / SEC"
                value={metrics.completed ? display(metrics.tps.mean, "", 1) : "—"}
                sub={
                  metrics.completed
                    ? `P95 ${display(metrics.tps.p95, "", 1)} · ${metrics.completed} completed`
                    : "Run a benchmark to measure"
                }
                tone="lime"
              />
              <Metric
                icon={<SlidersHorizontal size={15} />}
                label="INTER-TOKEN"
                value={
                  metrics.completed && metrics.itl.mean
                    ? display(metrics.itl.mean, " ms")
                    : "—"
                }
                sub={
                  metrics.completed && metrics.itl.mean
                    ? `P95 ${display(metrics.itl.p95, " ms")} · jitter`
                    : "Needs a streamed response"
                }
                tone="violet"
              />
            </div>

            <div className="summary-strip">
              <div>
                <span className="summary-label">Output tokens</span>
                <strong>{metrics.tokens.mean ? Math.round(metrics.tokens.mean) : "—"}</strong>
                <span className="summary-unit">tok / response</span>
              </div>
              <div>
                <span className="summary-label">Run health</span>
                <strong className={metrics.failed ? "warning-text" : "good-text"}>
                  {metrics.completed}/{result.results.length}
                </strong>
                <span className="summary-unit">successful</span>
              </div>
              <div>
                <span className="summary-label">Prompt</span>
                <strong>
                  {promptPreset === "custom"
                    ? "Custom"
                    : promptPresets.find((preset) => preset.id === promptPreset)?.label}
                </strong>
                <span className="summary-unit">
                  {prompt.trim().split(/\s+/).filter(Boolean).length} words
                </span>
              </div>
              <div className="export-group">
                <button
                  className="small-action save-pill-action"
                  onClick={openSaveModal}
                  disabled={!result.results.length || running}
                  title={
                    result.results.length
                      ? "Save this benchmark run internally"
                      : "Run a benchmark to save results"
                  }
                >
                  {isCurrentSaved ? <Check size={13} /> : <Bookmark size={13} />}
                  {isCurrentSaved ? "Saved" : "Save run"}
                </button>
                <button className="small-action" onClick={() => exportResults("csv")}>
                  <Download size={13} /> CSV
                </button>
                <button className="small-action" onClick={() => exportResults("json")}>
                  <FileJson size={13} /> JSON
                </button>
              </div>
            </div>

            <section className="panel chart-panel">
              <div className="chart-head">
                <div>
                  <span className="chart-title">Performance profile</span>
                  <span className="chart-subtitle">Run-by-run timing distribution</span>
                </div>
                <div className="view-tabs">
                  {(["overview", "timing", "tokens"] as const).map((view) => (
                    <button
                      key={view}
                      className={activeView === view ? "active" : ""}
                      onClick={() => setActiveView(view)}
                    >
                      {view}
                    </button>
                  ))}
                </div>
              </div>
              {activeView === "tokens" ? (
                <TokenTimeline runs={result.results} />
              ) : (
                <LatencyChart
                  runs={result.results}
                  chartMax={chartMax}
                  detailed={activeView === "timing"}
                />
              )}
            </section>

            {/* Current Benchmark Iterations Table */}
            <section className="panel table-panel" id="iterations">
              <div className="panel-header">
                <div>
                  <span className="panel-title">Current run breakdown</span>
                  <span className="panel-caption">Click an iteration to inspect its response</span>
                </div>
                <span className="panel-code">
                  <History size={12} /> {result.results.length} iterations
                </span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Iteration</th>
                      <th>TTFT</th>
                      <th>E2E latency</th>
                      <th>TPS</th>
                      <th>Tokens</th>
                      <th>ITL</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.results.map((run) => (
                      <tr
                        key={run.run}
                        onClick={() => setSelectedRun(run)}
                        className="clickable-row"
                      >
                        <td>
                          #{String(run.run).padStart(2, "0")}
                          {run.run === 1 && coldStart && <span className="cold-tag">cold</span>}
                        </td>
                        <td>{Math.round(run.ttft)} ms</td>
                        <td>{(run.latency / 1000).toFixed(2)} s</td>
                        <td>{run.status === "ready" ? run.tps.toFixed(1) : "—"}</td>
                        <td>{run.tokens || "—"}</td>
                        <td>
                          {run.tokenEvents && run.tokenEvents.length > 1
                            ? `${Math.round(
                                run.tokenEvents.slice(1).reduce((sum, token) => sum + token.deltaMs, 0) /
                                  (run.tokenEvents.length - 1)
                              )} ms`
                            : "—"}
                        </td>
                        <td className={run.status === "ready" ? "ok" : "error"}>
                          {run.status === "ready" ? "● ready" : "× error"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!result.results.length && (
                  <div className="empty-state">No completed iterations yet. Run a benchmark to view results.</div>
                )}
              </div>
            </section>

            {/* Saved Benchmark History Table */}
            <section className="panel table-panel history-panel" id="history">
              <div className="panel-header">
                <div>
                  <span className="panel-title">
                    <History size={13} className="title-icon" style={{ verticalAlign: -1, marginRight: 6 }} />
                    Saved benchmark history
                  </span>
                  <span className="panel-caption">
                    Previous benchmark runs saved internally · Click any run to inspect or reload
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="panel-code">
                    {history.length} {history.length === 1 ? "saved run" : "saved runs"}
                  </span>
                  {history.length > 0 && (
                    <button
                      className="action-chip-btn delete-btn"
                      onClick={handleClearAllHistory}
                      title="Clear all saved history"
                    >
                      <Trash2 size={11} /> Clear all
                    </button>
                  )}
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name / Model</th>
                      <th>Saved at</th>
                      <th>Config</th>
                      <th>Prompt</th>
                      <th>TTFT (mean)</th>
                      <th>Latency (mean)</th>
                      <th>TPS</th>
                      <th>Tokens</th>
                      <th>Health</th>
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => setSelectedSavedRun(item)}
                        className="clickable-row"
                      >
                        <td>
                          <div className="history-model-col">
                            <span className="history-model-title">
                              {item.name || item.model}
                            </span>
                            <span className="history-sub">
                              <span className="badge-tag accent">{item.model}</span>
                              <span className="badge-tag">{item.protocol}</span>
                            </span>
                          </div>
                        </td>
                        <td>
                          <div>{formatHistoryDate(item.savedAt)}</div>
                          <div className="history-sub">{formatRelativeTime(item.savedAt)}</div>
                        </td>
                        <td>
                          {item.config.runs} runs ·{" "}
                          {item.config.concurrency > 1
                            ? `${item.config.concurrency} par`
                            : "seq"}
                        </td>
                        <td>
                          <span className="badge-tag blue">
                            {item.promptPreset || "custom"}
                          </span>
                        </td>
                        <td>{Math.round(item.aggregate.ttft.mean)} ms</td>
                        <td>{(item.aggregate.latency.mean / 1000).toFixed(2)} s</td>
                        <td>{item.aggregate.tps.mean.toFixed(1)}</td>
                        <td>{Math.round(item.aggregate.tokens.mean)}</td>
                        <td className={item.aggregate.failed ? "warning-text" : "good-text"}>
                          {item.aggregate.completed}/{item.results.length}
                        </td>
                        <td>
                          <div
                            className="history-actions"
                            style={{ justifyContent: "flex-end" }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              className="action-chip-btn load-btn"
                              title="Load into dashboard and view charts"
                              onClick={() => loadSavedBenchmark(item)}
                            >
                              <RotateCcw size={11} /> Load
                            </button>
                            <button
                              className="action-chip-btn"
                              title="Inspect full results"
                              onClick={() => setSelectedSavedRun(item)}
                            >
                              <Eye size={11} /> Inspect
                            </button>
                            <button
                              className="action-chip-btn"
                              title="Download JSON export"
                              onClick={(e) => exportSavedRun(item, e)}
                            >
                              <FileJson size={11} />
                            </button>
                            <button
                              className="action-chip-btn delete-btn"
                              title="Delete this saved run"
                              onClick={(e) => handleDeleteSavedRun(item.id, e)}
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!history.length && (
                  <div className="empty-state">
                    No saved runs yet. Complete a benchmark above and click &quot;Save result&quot; to keep it in internal history.
                    {result.results.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <button
                          className="outline-button"
                          style={{ borderColor: "var(--lime)", color: "var(--lime)" }}
                          onClick={openSaveModal}
                        >
                          <Bookmark size={12} /> Save current benchmark now
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>

            <div className="footer-note">
              <span>Timing captured server-side with high-resolution monotonic clocks.</span>
              <span>
                Benchroom v0.1 ·{" "}
                {result.protocol === "responses" ? "Responses API" : "OpenAI-compatible"}
              </span>
            </div>
          </section>
        </div>
      </main>

      {/* Individual Run Inspection Modal */}
      {selectedRun && (
        <div className="modal-backdrop" role="presentation" onClick={() => setSelectedRun(null)}>
          <section
            className="run-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="run-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <div className="kicker">Iteration detail</div>
                <h2 id="run-title">Run #{String(selectedRun.run).padStart(2, "0")}</h2>
              </div>
              <button
                className="icon-btn"
                onClick={() => setSelectedRun(null)}
                aria-label="Close run detail"
              >
                <X size={17} />
              </button>
            </div>
            <div className="modal-metrics">
              <span>
                <b>{Math.round(selectedRun.ttft)} ms</b>TTFT
              </span>
              <span>
                <b>{(selectedRun.latency / 1000).toFixed(2)} s</b>E2E
              </span>
              <span>
                <b>{selectedRun.tps.toFixed(1)}</b>TPS
              </span>
            </div>
            <div className="response-label">Response preview</div>
            <pre className="response-preview">
              {selectedRun.output || selectedRun.error || "No response body captured."}
            </pre>
          </section>
        </div>
      )}

      {/* Save Benchmark Modal */}
      {saveModalOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setSaveModalOpen(false)}>
          <section
            className="run-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <div className="kicker">Internal Storage</div>
                <h2 id="save-title">Save Benchmark Run</h2>
              </div>
              <button
                className="icon-btn"
                onClick={() => setSaveModalOpen(false)}
                aria-label="Close modal"
              >
                <X size={17} />
              </button>
            </div>

            <div className="save-modal-preview">
              <div>
                <span>Model</span>
                <strong>{model}</strong>
              </div>
              <div>
                <span>Runs</span>
                <strong>{result.results.length} runs</strong>
              </div>
              <div>
                <span>TTFT</span>
                <strong>{Math.round(result.aggregate.ttft.mean)} ms</strong>
              </div>
              <div>
                <span>E2E Latency</span>
                <strong>{(result.aggregate.latency.mean / 1000).toFixed(2)} s</strong>
              </div>
            </div>

            <div className="save-modal-body">
              <div className="field">
                <label htmlFor="saveName">Run label / name</label>
                <input
                  id="saveName"
                  className="input"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="e.g. gpt-4o-mini baseline"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveBenchmark();
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="saveNotes">Notes (optional)</label>
                <textarea
                  id="saveNotes"
                  className="textarea compact"
                  value={saveNotes}
                  onChange={(e) => setSaveNotes(e.target.value)}
                  placeholder="e.g. Tested cold start with 0.2 temperature"
                />
              </div>
            </div>

            <div className="modal-footer">
              <button className="outline-button" onClick={() => setSaveModalOpen(false)}>
                Cancel
              </button>
              <button className="primary-action-btn" onClick={handleSaveBenchmark}>
                <Bookmark size={13} fill="currentColor" /> Save to History
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Saved Benchmark Inspection Detail Modal */}
      {selectedSavedRun && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setSelectedSavedRun(null)}
        >
          <section
            className="run-modal"
            style={{ width: "min(680px, 100%)" }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="saved-run-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <div className="kicker">Saved Benchmark Detail</div>
                <h2 id="saved-run-title">
                  {selectedSavedRun.name || selectedSavedRun.model}
                </h2>
                <div style={{ color: "var(--faint)", fontSize: 10, marginTop: 4 }}>
                  Saved on {formatHistoryDate(selectedSavedRun.savedAt)} ({formatRelativeTime(selectedSavedRun.savedAt)}) · {selectedSavedRun.endpoint}
                </div>
              </div>
              <button
                className="icon-btn"
                onClick={() => setSelectedSavedRun(null)}
                aria-label="Close detail"
              >
                <X size={17} />
              </button>
            </div>

            <div className="modal-metrics" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              <span>
                <b>{Math.round(selectedSavedRun.aggregate.ttft.mean)} ms</b>TTFT (Mean)
              </span>
              <span>
                <b>{(selectedSavedRun.aggregate.latency.mean / 1000).toFixed(2)} s</b>Latency (Mean)
              </span>
              <span>
                <b>{selectedSavedRun.aggregate.tps.mean.toFixed(1)}</b>TPS
              </span>
              <span>
                <b>{Math.round(selectedSavedRun.aggregate.tokens.mean)}</b>Tokens/Resp
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 8,
                marginBottom: 14,
                padding: "8px 10px",
                background: "#11191d",
                borderRadius: 4,
                fontSize: 10,
                color: "var(--muted)",
              }}
            >
              <div>
                <span style={{ color: "var(--faint)", display: "block" }}>Configuration</span>
                <strong>
                  {selectedSavedRun.config.runs} runs ·{" "}
                  {selectedSavedRun.config.concurrency > 1
                    ? `${selectedSavedRun.config.concurrency} parallel`
                    : "Sequential"}
                </strong>
              </div>
              <div>
                <span style={{ color: "var(--faint)", display: "block" }}>Output tokens</span>
                <strong>Max {selectedSavedRun.config.maxTokens} tok</strong>
              </div>
              <div>
                <span style={{ color: "var(--faint)", display: "block" }}>Temperature</span>
                <strong>{selectedSavedRun.config.temperature}</strong>
              </div>
            </div>

            {selectedSavedRun.notes && (
              <div style={{ marginBottom: 14 }}>
                <div className="response-label">Notes</div>
                <div
                  style={{
                    background: "#0d1518",
                    padding: "8px 11px",
                    borderRadius: 4,
                    fontSize: 11,
                    color: "var(--ink)",
                    border: "1px solid var(--line)",
                  }}
                >
                  {selectedSavedRun.notes}
                </div>
              </div>
            )}

            <div className="response-label">Prompt ({selectedSavedRun.promptPreset || "custom"})</div>
            <pre className="response-preview" style={{ maxHeight: 110, marginBottom: 14 }}>
              {selectedSavedRun.prompt}
            </pre>

            <div className="response-label">
              Iterations ({selectedSavedRun.results.length} total)
            </div>
            <div
              style={{
                maxHeight: 140,
                overflowY: "auto",
                border: "1px solid var(--line)",
                borderRadius: 4,
                marginBottom: 16,
              }}
            >
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>TTFT</th>
                    <th>Latency</th>
                    <th>TPS</th>
                    <th>Tokens</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSavedRun.results.map((run) => (
                    <tr key={run.run}>
                      <td>#{String(run.run).padStart(2, "0")}</td>
                      <td>{Math.round(run.ttft)} ms</td>
                      <td>{(run.latency / 1000).toFixed(2)} s</td>
                      <td>{run.status === "ready" ? run.tps.toFixed(1) : "—"}</td>
                      <td>{run.tokens || "—"}</td>
                      <td className={run.status === "ready" ? "ok" : "error"}>
                        {run.status === "ready" ? "● ready" : "× error"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-footer" style={{ justifyContent: "space-between" }}>
              <button
                className="action-chip-btn delete-btn"
                onClick={() => handleDeleteSavedRun(selectedSavedRun.id)}
              >
                <Trash2 size={12} /> Delete Run
              </button>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="outline-button"
                  onClick={(e) => exportSavedRun(selectedSavedRun, e)}
                >
                  <FileJson size={13} /> Export JSON
                </button>
                <button
                  className="primary-action-btn"
                  onClick={() => loadSavedBenchmark(selectedSavedRun)}
                >
                  <RotateCcw size={13} /> Load into Dashboard
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setShowSettings(false)}
        >
          <section
            className="run-modal settings-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <div className="kicker">Workspace</div>
                <h2>Runner settings</h2>
              </div>
              <button
                className="icon-btn"
                onClick={() => setShowSettings(false)}
                aria-label="Close settings"
              >
                <X size={17} />
              </button>
            </div>
            <p className="settings-copy">
              Benchroom runs requests from this server and stores saved benchmark runs internally on this machine and browser. API keys are never persisted.
            </p>
            <div className="settings-note">
              <GitCompare size={15} />
              <span>
                Comparison arena is ready for the next run: use the same prompt and settings against a second model to compare results.
              </span>
            </div>
          </section>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="toast" role="status">
          <Check size={14} color="var(--lime)" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: string;
}) {
  return (
    <div className={`metric-card ${tone}`}>
      <div className="metric-label">
        <span className="metric-icon">{icon}</span>
        {label}
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-foot">{sub}</div>
    </div>
  );
}

function LatencyChart({
  runs,
  chartMax,
  detailed,
}: {
  runs: RunResult[];
  chartMax: number;
  detailed: boolean;
}) {
  return (
    <div className="chart-wrap">
      <div className="axis-y">
        <span>{(chartMax / 1000).toFixed(1)}s</span>
        <span>{((chartMax * 0.66) / 1000).toFixed(1)}s</span>
        <span>{((chartMax * 0.33) / 1000).toFixed(1)}s</span>
        <span>0s</span>
      </div>
      <div className="chart-grid">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="bars">
        {runs.map((run) => (
          <div className="bar-group" key={run.run}>
            <div
              className="bar ttft"
              style={{ height: `${Math.max(3, (run.ttft / chartMax) * 100)}%` }}
            />
            <div
              className="bar latency"
              style={{ height: `${Math.max(4, (run.latency / chartMax) * 100)}%` }}
            />
            <span className="bar-label">{run.run}</span>
            {detailed && (
              <span className="bar-tooltip">
                {Math.round(run.ttft)} / {Math.round(run.latency)} ms
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function TokenTimeline({ runs }: { runs: RunResult[] }) {
  const timeline = runs.flatMap((run) =>
    (run.tokenEvents ?? []).slice(0, 28).map((event) => ({ ...event, run: run.run }))
  );
  const max = Math.max(...timeline.map((event) => event.deltaMs), 30);
  return (
    <div className="token-timeline">
      {timeline.length ? (
        timeline.map((event, index) => (
          <div
            className="token-event"
            key={`${event.run}-${event.index}-${index}`}
            title={`Run ${event.run} · ${Math.round(event.deltaMs)}ms`}
          >
            <span style={{ height: `${Math.max(12, (event.deltaMs / max) * 100)}%` }} />
            <small>r{event.run}</small>
          </div>
        ))
      ) : (
        <div className="empty-state">Token arrival events will appear after a streamed run.</div>
      )}
    </div>
  );
}
