# Security policy

## Intended use

Model Bench is a local, single-user benchmarking tool. The default development and production commands bind to `127.0.0.1`.

The application has **no authentication or per-user isolation**. Its benchmark API can contact user-selected HTTP(S) endpoints, including private network services. Anyone who can reach the app can run benchmarks, read saved prompts and outputs, or delete history.

**Do not expose the app directly to the public internet.** Publishing its source on GitHub does not make it suitable for an unauthenticated public deployment. A shared deployment needs authentication, authorization, endpoint/network restrictions, rate limits, transport security, and a suitable storage design.

Write requests require JSON content types rather than plain-text or form submissions. This is not authentication and does not make a public deployment safe.

## Credentials and saved data

- API keys and custom headers are sent from the browser to the application server and then to the configured provider.
- Saved benchmark records use an allowlist and omit API-key fields, custom headers, and unknown fields. They retain endpoint URLs, prompts, outputs, errors, names, and notes; those text fields can still contain sensitive information.
- Do not embed credentials in endpoint URLs, prompts, notes, or test data. URL username/password credentials are rejected.
- Server history lives in `data/history.json` by default. The browser also caches saved results in local storage, including when the server is unavailable. Clear both locations when removing sensitive data.
- `data/`, local environment files, private-key files, logs, and generated output are ignored by Git. If you change the history directory, add it to your local ignore rules before saving data there.
- An ignore rule does not remove a secret already committed. Revoke/rotate exposed credentials first, then remove them from repository history before publication.

## Reporting a vulnerability

Do not open a public issue with exploit details or credentials. Use the repository's **Security → Advisories → Report a vulnerability** option when private vulnerability reporting is enabled. If it is unavailable, ask the maintainer for a private reporting channel without disclosing the vulnerability publicly.

Include the affected commit or version, impact, and a minimal reproduction using dummy credentials. No response-time guarantee is currently offered.

## Supported fixes

Security fixes target the current code on the repository's default branch. Older snapshots do not have a separate maintenance guarantee.
