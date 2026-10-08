"use client";

import { useMemo, useRef, useState } from "react";
import { Download, FileJson, Gauge, GitCompare, History, KeyRound, Play, Settings2, SlidersHorizontal, Timer, Zap, X } from "lucide-react";
import { aggregateRuns } from "@/src/lib/metrics";
import { promptById, promptPresets } from "@/src/lib/prompts";
import { providerPresets } from "@/src/lib/providers";
import type { AggregatedMetrics, BenchmarkResponse, EndpointProtocol, PromptPreset, RunResult } from "@/src/lib/types";

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
  const rows = results.map((run) => [run.run, run.ttft.toFixed(2), run.latency.toFixed(2), run.tps.toFixed(2), run.tokens, run.status, run.error ?? ""].map(csvCell).join(","));
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
  const [result, setResult] = useState<BenchmarkResponse>({ results: seedRuns, aggregate: initialAggregate, model: "gpt-4o-mini", endpoint: "https://api.openai.com/v1", protocol: "responses", completedAt: new Date().toISOString() });
  const [activeView, setActiveView] = useState<"overview" | "timing" | "tokens">("overview");
  const [selectedRun, setSelectedRun] = useState<RunResult | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const metrics = result.aggregate;
  const chartMax = Math.max(...result.results.map((run) => run.latency), 2000);
  const prompt = promptPreset === "custom" ? customPrompt : promptById[promptPreset];
  const selectedPreset = providerPresets.find((preset) => preset.id === providerId);

  function applyProvider(id: string) {
    const preset = providerPresets.find((item) => item.id === id);
    if (!preset) return;
    setProviderId(id); setEndpoint(preset.endpoint); setProtocol(preset.protocol); setModel(preset.model);
  }

  const abortRef = useRef<AbortController | null>(null);

  async function startBenchmark() {
    setRunning(true); setRunError(""); setSelectedRun(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let headers: Record<string, string> = {};
      if (customHeaders.trim()) {
        try { headers = JSON.parse(customHeaders) as Record<string, string>; } catch { throw new Error("Custom headers must be valid JSON"); }
      }
      if (!prompt.trim()) throw new Error("Add a prompt before starting the benchmark");
      const response = await fetch("/api/benchmark", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ endpoint, apiKey, model, protocol, runs: Number(runs), concurrency: Number(concurrency), prompt, maxTokens: Number(maxTokens), temperature: Number(temperature), stream, coldStart, headers }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Benchmark failed" }));
        throw new Error(payload.error || "Benchmark failed");
      }
      if (!response.body) throw new Error("Benchmark stream was empty");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      const currentRuns: RunResult[] = [];
      for (;;) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim(); if (!payload) continue;
          let event: { type: string; result?: RunResult; results?: RunResult[]; aggregate?: AggregatedMetrics; completedAt?: string; error?: string };
          try { event = JSON.parse(payload) as typeof event; } catch { continue; }
          if (event.type === "meta") {
            setResult((previous) => ({ ...previous, results: [], aggregate: aggregateRuns([]), model, endpoint, protocol, completedAt: new Date().toISOString() }));
          } else if (event.type === "run" && event.result) {
            currentRuns.push(event.result);
            setResult((previous) => ({ ...previous, results: [...currentRuns], aggregate: aggregateRuns(currentRuns), model, endpoint, protocol, completedAt: new Date().toISOString() }));
          } else if (event.type === "done") {
            const finalRuns = event.results ?? currentRuns;
            setResult((previous) => ({ ...previous, results: finalRuns, aggregate: event.aggregate ?? aggregateRuns(finalRuns), model, endpoint, protocol, completedAt: event.completedAt ?? new Date().toISOString() }));
          } else if (event.type === "error") {
            throw new Error(event.error || "Benchmark failed");
          }
        }
        if (chunk.done) {
          if (buffer.trim().startsWith("data:")) {
            const payload = buffer.trim().slice(5).trim();
            if (payload) {
              try {
                const event = JSON.parse(payload) as { type: string; result?: RunResult; results?: RunResult[]; aggregate?: AggregatedMetrics; completedAt?: string; error?: string };
                if (event.type === "run" && event.result) {
                  currentRuns.push(event.result);
                  setResult((previous) => ({ ...previous, results: [...currentRuns], aggregate: aggregateRuns(currentRuns), model, endpoint, protocol, completedAt: new Date().toISOString() }));
                } else if (event.type === "done") {
                  const finalRuns = event.results ?? currentRuns;
                  setResult((previous) => ({ ...previous, results: finalRuns, aggregate: event.aggregate ?? aggregateRuns(finalRuns), model, endpoint, protocol, completedAt: event.completedAt ?? new Date().toISOString() }));
                }
              } catch { /* Ignore a malformed trailing frame. */ }
            }
          }
          break;
        }
      }
      setActiveView("overview");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") setRunError("Benchmark cancelled");
      else setRunError(error instanceof Error ? error.message : "Unable to run benchmark");
    } finally { abortRef.current = null; setRunning(false); }
  }

  function cancelBenchmark() {
    abortRef.current?.abort();
  }

  function exportResults(format: "json" | "csv") {
    const body = format === "json" ? JSON.stringify({ ...result, config: { endpoint, model, protocol, runs, concurrency, promptPreset, maxTokens, temperature } }, null, 2) : buildCsv(result.results);
    const blob = new Blob([body], { type: format === "json" ? "application/json" : "text/csv" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = `benchroom-${model.replace(/[^a-z0-9]+/gi, "-")}-${Date.now()}.${format}`;
    document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">⌁</span><span>benchroom</span><span className="brand-version">v0.1</span></div>
        <nav className="nav-links" aria-label="Primary"><a href="#benchmark">Benchmark</a><a href="#history">History</a><a href="#docs">Docs</a></nav>
        <div className="header-actions"><span className="status"><i className="status-dot" /> Backend ready</span><button className="icon-btn" aria-label="Workspace settings" onClick={() => setShowSettings(true)}><Settings2 size={16} /></button><span className="avatar" aria-label="Account" /></div>
      </header>

      <main className="content" id="benchmark">
        <div className="page-heading"><div><div className="kicker">Inference performance lab</div><h1>Model benchmark</h1><p className="subheading">Measure streaming performance before it reaches production.</p></div><div className="heading-actions"><button className="outline-button" onClick={() => exportResults("json")}><FileJson size={14} /> Export JSON</button><div className="live-chip">● &nbsp; SERVER-SIDE RUNNER</div></div></div>

        <div className="workspace">
          <aside className="panel config-panel">
            <div className="panel-header"><span className="panel-title">Benchmark setup</span><span className="panel-code">01 / 03</span></div>
            <div className="config-body">
              <div className="section-label">Provider preset</div>
              <div className="provider-grid">{providerPresets.map((preset) => <button key={preset.id} className={`provider-card ${providerId === preset.id ? "selected" : ""}`} onClick={() => applyProvider(preset.id)}><span className="provider-name">{preset.name}</span><span className="provider-hint">{preset.hint}</span></button>)}</div>
              <div className="field"><label htmlFor="endpoint">Base endpoint</label><input id="endpoint" className="input" value={endpoint} onChange={(event) => { setEndpoint(event.target.value); setProviderId("custom"); }} /></div>
              <div className="split-fields"><div className="field"><label htmlFor="protocol">Protocol</label><select id="protocol" className="select" value={protocol} onChange={(event) => setProtocol(event.target.value as EndpointProtocol)}><option value="responses">Responses</option><option value="chat">Chat completions</option><option value="custom">Custom payload</option></select></div><div className="field"><label htmlFor="model">Model ID</label><input id="model" className="input" value={model} onChange={(event) => setModel(event.target.value)} /></div></div>
              <div className="field"><label htmlFor="apiKey"><KeyRound size={11} /> API key</label><input id="apiKey" className="input" type="password" placeholder={selectedPreset?.category === "Local" ? "Optional for local" : "sk-..."} value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></div>
              <button className="advanced-toggle" onClick={() => setHeadersOpen((open) => !open)}><SlidersHorizontal size={12} /> {headersOpen ? "Hide" : "Add"} custom headers <span>{headersOpen ? "−" : "+"}</span></button>
              {headersOpen && <div className="field"><label htmlFor="headers">Headers JSON</label><textarea id="headers" className="textarea compact" placeholder={'{"X-Project": "benchroom"}'} value={customHeaders} onChange={(event) => setCustomHeaders(event.target.value)} /></div>}

              <div className="section-divider" /><div className="section-label">Run settings</div>
              <div className="split-fields"><div className="field"><label htmlFor="runs">Runs</label><select id="runs" className="select" value={runs} onChange={(event) => setRuns(event.target.value)}><option value="1">1 run</option><option value="3">3 runs</option><option value="5">5 runs</option><option value="8">8 runs</option><option value="10">10 runs</option><option value="20">20 runs</option></select></div><div className="field"><label htmlFor="concurrency">Concurrency</label><select id="concurrency" className="select" value={concurrency} onChange={(event) => setConcurrency(event.target.value)}><option value="1">Sequential</option><option value="2">2 parallel</option><option value="3">3 parallel</option><option value="5">5 parallel</option></select></div></div>
              <div className="field"><label htmlFor="promptPreset">Prompt profile</label><select id="promptPreset" className="select" value={promptPreset} onChange={(event) => setPromptPreset(event.target.value as PromptPreset)}>{promptPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label} · {preset.tokenEstimate}</option>)}<option value="custom">Custom prompt</option></select></div>
              {promptPreset === "custom" ? <div className="field"><label htmlFor="customPrompt">Prompt</label><textarea id="customPrompt" className="textarea" placeholder="Write the exact prompt to benchmark..." value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} /></div> : <div className="prompt-preview">{prompt}</div>}
              <div className="split-fields"><div className="field"><label htmlFor="maxTokens">Max output tokens</label><input id="maxTokens" className="input" type="number" min="1" max="4096" value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} /></div><div className="field"><label htmlFor="temperature">Temperature <b>{temperature}</b></label><input id="temperature" className="range" type="range" min="0" max="1" step="0.1" value={temperature} onChange={(event) => setTemperature(event.target.value)} /></div></div>
              <div className="checks"><label className="check-row"><input type="checkbox" checked={stream} onChange={(event) => setStream(event.target.checked)} /> Stream chunks</label><label className="check-row"><input type="checkbox" checked={coldStart} onChange={(event) => setColdStart(event.target.checked)} /> Mark cold start</label></div>
              <button className={`run-button ${running ? "running" : ""}`} onClick={running ? cancelBenchmark : startBenchmark} disabled={false}>{running ? <><span className="button-pulse" /> CANCEL BENCHMARK</> : <><Play size={14} fill="currentColor" /> RUN BENCHMARK</>}</button>
              <div className="helper">Server-side proxy · keys stay on this machine</div>{runError && <div className="error-box">{runError}</div>}
            </div>
          </aside>

          <section className="results" aria-live="polite">
            <div className="metric-grid"><Metric icon={<Timer size={15} />} label="TTFT" value={metrics.completed ? display(metrics.ttft.mean, " ms") : "—"} sub={metrics.completed ? `P95 ${display(metrics.ttft.p95, " ms")} · ±${display(metrics.ttft.stdev, " ms")}` : "Run a benchmark to measure"} tone="orange" /><Metric icon={<Gauge size={15} />} label="E2E LATENCY" value={metrics.completed ? display(metrics.latency.mean / 1000, " s", 2) : "—"} sub={metrics.completed ? `P95 ${display(metrics.latency.p95 / 1000, " s", 2)} · ±${display(metrics.latency.stdev, " ms")}` : "Run a benchmark to measure"} tone="blue" /><Metric icon={<Zap size={15} />} label="TOKENS / SEC" value={metrics.completed ? display(metrics.tps.mean, "", 1) : "—"} sub={metrics.completed ? `P95 ${display(metrics.tps.p95, "", 1)} · ${metrics.completed} completed` : "Run a benchmark to measure"} tone="lime" /><Metric icon={<SlidersHorizontal size={15} />} label="INTER-TOKEN" value={metrics.completed && metrics.itl.mean ? display(metrics.itl.mean, " ms") : "—"} sub={metrics.completed && metrics.itl.mean ? `P95 ${display(metrics.itl.p95, " ms")} · jitter` : "Needs a streamed response"} tone="violet" /></div>
            <div className="summary-strip"><div><span className="summary-label">Output tokens</span><strong>{metrics.tokens.mean ? Math.round(metrics.tokens.mean) : "—"}</strong><span className="summary-unit">tok / response</span></div><div><span className="summary-label">Run health</span><strong className={metrics.failed ? "warning-text" : "good-text"}>{metrics.completed}/{result.results.length}</strong><span className="summary-unit">successful</span></div><div><span className="summary-label">Prompt</span><strong>{promptPreset === "custom" ? "Custom" : promptPresets.find((preset) => preset.id === promptPreset)?.label}</strong><span className="summary-unit">{prompt.trim().split(/\s+/).filter(Boolean).length} words</span></div><div className="export-group"><button className="small-action" onClick={() => exportResults("csv")}><Download size={13} /> CSV</button><button className="small-action" onClick={() => exportResults("json")}><FileJson size={13} /> JSON</button></div></div>

            <section className="panel chart-panel"><div className="chart-head"><div><span className="chart-title">Performance profile</span><span className="chart-subtitle">Run-by-run timing distribution</span></div><div className="view-tabs">{(["overview", "timing", "tokens"] as const).map((view) => <button key={view} className={activeView === view ? "active" : ""} onClick={() => setActiveView(view)}>{view}</button>)}</div></div>{activeView === "tokens" ? <TokenTimeline runs={result.results} /> : <LatencyChart runs={result.results} chartMax={chartMax} detailed={activeView === "timing"} />}</section>

            <section className="panel table-panel" id="history"><div className="panel-header"><div><span className="panel-title">Run history</span><span className="panel-caption">Click a run to inspect its response</span></div><span className="panel-code"><History size={12} /> {result.results.length} runs</span></div><div className="table-wrap"><table><thead><tr><th>Run</th><th>TTFT</th><th>E2E latency</th><th>TPS</th><th>Tokens</th><th>ITL</th><th>Status</th></tr></thead><tbody>{result.results.map((run) => <tr key={run.run} onClick={() => setSelectedRun(run)} className="clickable-row"><td>#{String(run.run).padStart(2, "0")}{run.run === 1 && coldStart && <span className="cold-tag">cold</span>}</td><td>{Math.round(run.ttft)} ms</td><td>{(run.latency / 1000).toFixed(2)} s</td><td>{run.status === "ready" ? run.tps.toFixed(1) : "—"}</td><td>{run.tokens || "—"}</td><td>{run.tokenEvents && run.tokenEvents.length > 1 ? `${Math.round(run.tokenEvents.slice(1).reduce((sum, token) => sum + token.deltaMs, 0) / (run.tokenEvents.length - 1))} ms` : "—"}</td><td className={run.status === "ready" ? "ok" : "error"}>{run.status === "ready" ? "● ready" : "× error"}</td></tr>)}</tbody></table>{!result.results.length && <div className="empty-state">No completed runs yet.</div>}</div></section>
            <div className="footer-note"><span>Timing captured server-side with high-resolution monotonic clocks.</span><span>Benchroom v0.1 · {result.protocol === "responses" ? "Responses API" : "OpenAI-compatible"}</span></div>
          </section>
        </div>
      </main>

      {selectedRun && <div className="modal-backdrop" role="presentation" onClick={() => setSelectedRun(null)}><section className="run-modal" role="dialog" aria-modal="true" aria-labelledby="run-title" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><div className="kicker">Run detail</div><h2 id="run-title">Run #{String(selectedRun.run).padStart(2, "0")}</h2></div><button className="icon-btn" onClick={() => setSelectedRun(null)} aria-label="Close run detail"><X size={17} /></button></div><div className="modal-metrics"><span><b>{Math.round(selectedRun.ttft)} ms</b>TTFT</span><span><b>{(selectedRun.latency / 1000).toFixed(2)} s</b>E2E</span><span><b>{selectedRun.tps.toFixed(1)}</b>TPS</span></div><div className="response-label">Response preview</div><pre className="response-preview">{selectedRun.output || selectedRun.error || "No response body captured."}</pre></section></div>}
      {showSettings && <div className="modal-backdrop" role="presentation" onClick={() => setShowSettings(false)}><section className="run-modal settings-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><div className="kicker">Workspace</div><h2>Runner settings</h2></div><button className="icon-btn" onClick={() => setShowSettings(false)} aria-label="Close settings"><X size={17} /></button></div><p className="settings-copy">Benchroom runs requests from this server and does not persist API keys or benchmark responses. Use custom headers for provider-specific routing metadata.</p><div className="settings-note"><GitCompare size={15} /><span>Comparison arena is ready for the next run: use the same prompt and settings against a second model to compare results.</span></div></section></div>}
    </div>
  );
}

function Metric({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub: string; tone: string }) {
  return <div className={`metric-card ${tone}`}><div className="metric-label"><span className="metric-icon">{icon}</span>{label}</div><div className="metric-value">{value}</div><div className="metric-foot">{sub}</div></div>;
}

function LatencyChart({ runs, chartMax, detailed }: { runs: RunResult[]; chartMax: number; detailed: boolean }) {
  return <div className="chart-wrap"><div className="axis-y"><span>{(chartMax / 1000).toFixed(1)}s</span><span>{(chartMax * .66 / 1000).toFixed(1)}s</span><span>{(chartMax * .33 / 1000).toFixed(1)}s</span><span>0s</span></div><div className="chart-grid"><span /><span /><span /><span /></div><div className="bars">{runs.map((run) => <div className="bar-group" key={run.run}><div className="bar ttft" style={{ height: `${Math.max(3, (run.ttft / chartMax) * 100)}%` }} /><div className="bar latency" style={{ height: `${Math.max(4, (run.latency / chartMax) * 100)}%` }} /><span className="bar-label">{run.run}</span>{detailed && <span className="bar-tooltip">{Math.round(run.ttft)} / {Math.round(run.latency)} ms</span>}</div>)}</div></div>;
}

function TokenTimeline({ runs }: { runs: RunResult[] }) {
  const timeline = runs.flatMap((run) => (run.tokenEvents ?? []).slice(0, 28).map((event) => ({ ...event, run: run.run })));
  const max = Math.max(...timeline.map((event) => event.deltaMs), 30);
  return <div className="token-timeline">{timeline.length ? timeline.map((event, index) => <div className="token-event" key={`${event.run}-${event.index}-${index}`} title={`Run ${event.run} · ${Math.round(event.deltaMs)}ms`}><span style={{ height: `${Math.max(12, (event.deltaMs / max) * 100)}%` }} /><small>r{event.run}</small></div>) : <div className="empty-state">Token arrival events will appear after a streamed run.</div>}</div>;
}
