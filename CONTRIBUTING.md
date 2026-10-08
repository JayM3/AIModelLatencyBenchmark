# Contributing

Thanks for helping improve Model Bench (the Benchroom interface).

## Local setup

Use Node.js 22.18 or newer; CI tests Node.js 22 and 24. The `.nvmrc` file selects Node.js 24 for compatible version managers.

```sh
npm ci
npm run dev
```

No environment file or API key is needed to start the app or run its tests. If you need a different history directory, copy `.env.example` to `.env.local` and set `MODEL_BENCH_DATA_DIR`. Keep that directory out of Git.

The app listens on the local machine by default. Use a mock server or your own inference endpoint for manual testing. Real provider requests can incur charges.

## Before opening a pull request

```sh
npm run check
npm audit --audit-level=high
```

`npm run check` runs TypeScript checks, the Node.js test suite, and a production build. Tests use mocked requests or temporary directories and do not require paid inference calls.

- Keep changes focused and add regression tests for behavior changes.
- Keep metric definitions and setup instructions in sync with the code.
- Use two-space indentation and LF line endings.
- Avoid new dependencies unless they solve a clear need; update the lockfile whenever dependencies change.
- Check responsive layout and keyboard operation when changing the interface.
- Never commit credentials, `.env.local`, generated files, or private benchmark history. Screenshots and fixtures must use dummy data.


The scoped PostCSS override in `package.json` keeps the current Next.js 15 line on a patched PostCSS 8 release. Do not remove it without checking the dependency audit and production build.

## Areas of the project

- `app/` contains the Next.js interface and HTTP routes.
- `src/lib/benchmark*.ts` and `src/lib/metrics.ts` implement execution and measurements.
- `src/lib/request-validation.ts` validates incoming benchmark options.
- `src/lib/saved-benchmark.ts` validates and allowlists saved records.
- `src/lib/history-store.ts` persists server history; `src/lib/history.ts` provides browser persistence and fallback.
- `test/` contains regression tests.

## Reporting problems

Use the bug or feature template for ordinary issues. For vulnerabilities or accidental credential exposure, follow [SECURITY.md](SECURITY.md) instead of posting sensitive details publicly.
