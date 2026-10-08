# Model Bench

**A local LLM inference performance lab, with the Benchroom web interface.**

Compare streaming behavior across OpenAI-compatible, Responses-style, and custom endpoints. Measure what happens from this application's server to your inference provider, then inspect individual runs and compare saved results.

## Features

- Measure time to first token (TTFT), end-to-end latency, throughput, token counts, and inter-token latency.
- Compare distributions with mean, median, p95, minimum, maximum, and standard deviation.
- Configure provider presets or a custom endpoint, model, prompt, request headers, streaming, and concurrency.
- Inspect individual runs, generated output, and stream-chunk arrival timing.
- Save, reload, compare, delete, and export benchmark results through the interface.

## Quick start

Use **Node.js 22.18 or newer** and npm. Node.js 22 and 24 are checked in CI; `.nvmrc` selects Node.js 24.

```sh
npm ci
npm run dev
```

Open **http://localhost:3000**, choose a provider or enter an HTTP(S) endpoint and model, add an API key if required, and start a benchmark. No environment file is required. Local providers must already be running; cloud requests may incur charges. Preset model names are examples, not a guarantee of provider availability.

Both development and production commands bind to the local machine (`127.0.0.1`) by default.

For a production build:

```sh
npm run build
npm start
```

Use `npm run dev -- --port 3001` or `npm start -- --port 3001` if port 3000 is already in use.

> **Local, trusted use only.** There is no authentication or user isolation. Do not expose the app directly to the public internet. Read [SECURITY.md](SECURITY.md) before sharing or hosting it.

## Benchmark settings

| Setting | Range / behavior |
| --- | --- |
| Runs | 1–20 |
| Concurrency | 1–5 requests per batch |
| Maximum output tokens | 1–4096 |
| Temperature | 0–2 |
| Request timeout | 120 seconds per request |
| Protocol | Chat Completions, Responses, or a custom endpoint |
| Streaming | Enabled by default; can be disabled in settings |

Run counts, concurrency, and token limits are normalized to whole numbers. Failed requests remain visible but are excluded from metric distributions. Cancellation stops outstanding requests and prevents subsequent batches.

### Interpreting measurements

- Timings are measured on the app server and include the network path to the provider. They are not model-only compute measurements or browser-to-provider timings.
- With streaming disabled, first-token arrival cannot be observed; TTFT is reported as full request latency.
- Token counts use provider-reported usage where available and otherwise use a rough character-based estimate.
- Streaming throughput divides output tokens by the time from first output to request completion. Non-streaming throughput uses full request latency.
- Inter-token timing follows received stream chunks, which may contain multiple tokens. Output text and timing events are retained only up to the runner's display limits (4,000 characters and 500 events per run).
- Provider caching, batching, rate limits, and network conditions affect comparisons. The cold-start toggle does not force a provider to unload a model or clear its cache.

## Saved results and credentials

Server history is stored in `data/history.json`. Saved results are also cached in browser local storage, with a local fallback when the server cannot save or load history. The default `data/` directory is excluded from Git.

For a different server history directory, copy `.env.example` to `.env.local` and set `MODEL_BENCH_DATA_DIR`. Relative paths are resolved from the project root. Keep a custom directory outside version control and on persistent, writable storage if results must survive restarts or container replacement. File-backed history is intended for one application process, not a multi-instance deployment.

The browser sends the API key and custom headers to the app server for each benchmark; the server forwards them to your selected provider. Saved records allowlist benchmark fields and omit credentials/custom headers. Endpoint URLs, prompts, outputs, errors, names, and notes are still retained, so do not put sensitive content in those fields. Never embed credentials in an endpoint URL.

## Development

```sh
npm run check
npm audit --audit-level=high
```

The combined check runs these individually available commands:

```sh
npm run typecheck
npm test
npm run build
```

Tests use mocked provider requests or temporary storage; no API key or paid inference calls are required. GitHub Actions installs from the committed lockfile and runs the audit and checks on Node.js 22 and 24. Dependabot proposes dependency and workflow updates.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidance and [docs/PUBLISHING.md](docs/PUBLISHING.md) for the GitHub publication checklist.

## Project structure

- `app/page.tsx`: benchmark interface and saved-results views.
- `app/api/benchmark/route.ts`: validated requests and streamed progress updates.
- `app/api/history/route.ts`: saved benchmark HTTP API.
- `src/lib/benchmark.ts`: bounded batch execution and progress events.
- `src/lib/benchmark-runner.ts`: provider requests, streaming, and measurements.
- `src/lib/metrics.ts`: distributions and aggregation.
- `src/lib/request-validation.ts` and `src/lib/saved-benchmark.ts`: input validation and saved-field allowlisting.
- `src/lib/history-store.ts` and `src/lib/history.ts`: server storage and browser fallback.
- `src/lib/providers.ts` and `src/lib/prompts.ts`: interface presets.
- `test/`: regression tests.

## License

[MIT](LICENSE).
