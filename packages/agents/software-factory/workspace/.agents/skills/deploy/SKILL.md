---
name: deploy
description: Set up GitHub Actions to build the Vite + React app and deploy it to GitHub Pages. Use when user wants to ship the app, configure deployment, publish a preview URL, or asks to "deploy".
---

# Deploy

Wire the static React app to GitHub Pages via GitHub Actions. Run once per repo — the workflow then auto-deploys on every push to `main`.

## Preconditions

- `gh auth status` succeeds and the user has admin on the repo (Pages config requires admin).
- The repo follows `DEVELOPMENT_GUIDELINES.md`: TypeScript + React + Vite. If `vite.config.ts` is missing or the stack differs, stop and surface the mismatch.
- `config.json` exists in the workspace and lists the GitHub repo (`owner/repo`).

## Process

### 1. Set the Vite base path

GitHub Pages serves the app under `https://<owner>.github.io/<repo>/`. In `vite.config.ts` set:

```ts
export default defineConfig({
  base: '/<repo>/',
  plugins: [react()],
})
```

Use the repo name from `config.json`. If a custom domain is configured, use `base: '/'` instead.

### 2. Add the deploy workflow

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

If the project uses `pnpm` or `yarn`, swap the install/build steps accordingly. Vite outputs to `dist` by default — change `path:` if the project sets `build.outDir`.

### 3. Enable Pages with Actions as the source

```sh
gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
```

If Pages already exists, switch the source instead:

```sh
gh api -X PUT repos/<owner>/<repo>/pages -f build_type=workflow
```

### 4. Ship and verify

Commit on a branch, open a PR, merge to `main`. Then:

```sh
gh run watch
gh api repos/<owner>/<repo>/pages --jq .html_url
```

Report the live URL back to the user.

## Notes

- Routing: if the app uses client-side routing, copy `dist/index.html` to `dist/404.html` in the build step so deep links work on Pages.
- Secrets/env: GitHub Pages serves only static files — anything in `import.meta.env.*` ends up in the bundle. Never wire production secrets through Vite envs.
