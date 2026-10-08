# Publishing on GitHub

This checklist prepares the source repository; it does not deploy the application or publish an npm package. The package is intentionally marked `private`.

## 1. Verify the project

```sh
npm ci
npm run check
npm audit --audit-level=high
```

Check that README.md accurately describes the app and that you have the rights to publish the code under the existing MIT license.

## 2. Review exactly what will be uploaded

```sh
git status --short
git diff
git ls-files
```

Keep API keys, local environment files, `data/`, browser exports, private endpoint details, and generated build output out of the repository. If you configure a custom history directory, ignore it too. Inspect commit history as well as current files: ignores do not protect previously committed secrets.

This checkout may already have uncommitted work. Review all of it; do not discard unrelated changes or overwrite an existing remote.

## 3. Create the repository and push

Create an **empty** repository on GitHub, with the visibility you intend. Do not initialize it with a README or license because this project already includes both.

Choose the default branch name before pushing. You can keep the current branch; if you want `main`, rename it only after checking that a conflicting local branch does not exist.

After reviewing the files:

```sh
git add .
git diff --cached --stat
git diff --cached
# Commit only after reviewing the staged content.
git commit -m "Prepare Model Bench for GitHub"
git remote -v
# Run this only if origin is not already configured; replace both placeholders.
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin HEAD
```

Use GitHub's normal authenticated Git access. Never put a personal access token in the remote URL.

## 4. Configure repository protections

- Confirm the pushed branch is the intended default branch.
- Wait for both Node.js CI jobs to pass.
- Enable dependency alerts and private vulnerability reporting where available.
- Protect the default branch with pull-request review and the CI checks.
- Confirm the README, MIT license, contributor guide, issue forms, and security policy render correctly.

## Hosting is separate

The app needs a Node.js server for benchmark requests and history; it is not a static GitHub Pages site. A writable, persistent history directory is required for durable server saves. File-backed history assumes one application process; use a shared database before scaling to multiple instances.

Review [SECURITY.md](../SECURITY.md) before any shared deployment. The app is intentionally unauthenticated and local-only by default.
