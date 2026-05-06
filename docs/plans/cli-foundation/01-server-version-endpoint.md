# Issue 1 — Server `/api/version` endpoint

**Depends on:** —
**Blocks:** 5, 6

## Context

Foundation work for the `dam` CLI ([ADR-039](../../adrs/039-cli-foundation.md), spec at [README.md](README.md), tracking issue [#79](https://github.com/dam-agents/dam/issues/79)). The CLI needs an unauthenticated way to ask the api-server for its own version and the minimum CLI version it accepts. ADR-039 commits this endpoint to plain HTTP, deliberately outside the tRPC surface so it can be called before any authentication or client setup.

**Why now:** every CLI verb that talks to the network ([#86](https://github.com/dam-agents/dam/issues/86), and v1 verbs `ping` / `version` from issues 5 and 6 here) negotiates compatibility against this endpoint. It can ship independently of CLI work and unblocks issues 5/6.

## Scope

Add one endpoint, plumb the floor through Helm, test it.

- `GET /api/version` on the api-server — unauthenticated, returns `{ serverVersion, minClientVersion }` as JSON.
- `serverVersion` reflects the deployed api-server build (read from `package.json` at runtime, not a build-time stub that drifts when the deployment is upgraded but the image tag is reused).
- `minClientVersion` is read from configuration (env var, fed by Helm), with a safe default (`0.0.0` — matches anything).
- The endpoint is registered **before** the auth middleware mount in `app.ts` (the existing pattern used by `/api/health`, `/api/auth/config`, `/api/brand`).

This issue does not touch any CLI code.

## Deliverables

### api-server (TypeScript)

- **`packages/api-server/src/apps/api-server/app.ts`** — register `app.get("/api/version", …)` before `app.use("/api/*", auth.middleware)` (currently around line 145), alongside the existing `/api/health` and `/api/brand` routes. The handler returns `{ serverVersion, minClientVersion }`.
- **`packages/api-server/src/config.ts`** — add `minClientCliVersion: z.string()` (or chosen identifier) with default `"0.0.0"`, plumbed from a new env var `MIN_CLIENT_CLI_VERSION`. Mirror the existing config-from-env pattern.
- **Server version resolution** — read the api-server `package.json` `version` field at startup (e.g. via `JSON.parse(readFileSync("package.json"))` from a known-relative path, or via `import.meta` resolution; pick whatever is consistent with how the build emits the dist). Inject the resolved string into the route handler. Do **not** bake a constant in source that has to be hand-bumped.

### Helm

- **`deploy/helm/platform/values.yaml`** — add `apiServer.minClientCliVersion: "0.0.0"` under the existing `apiServer` block.
- **`deploy/helm/platform/templates/apiserver/app.yaml`** — add `MIN_CLIENT_CLI_VERSION` to the api-server container's `env:` list, sourced from `.Values.apiServer.minClientCliVersion`.

### Tests

- **`packages/api-server/src/__tests__/version.test.ts`** (new) — boots the Hono app (or routes a fake request through it), asserts:
  - `GET /api/version` returns 200 with `{ serverVersion, minClientVersion }` of the right shape.
  - The response is the same with **and** without an `Authorization` header (auth middleware does not run on this path).
  - When `MIN_CLIENT_CLI_VERSION` is set, the response reflects that value; when absent, it falls back to the default.
- Follow the existing test pattern in `packages/api-server/src/__tests__/auth.test.ts`.

## Acceptance criteria

- `mise run check` passes.
- `mise run api-server:test:unit` passes (new test included).
- `mise run helm:check:render` renders the chart with the new env var present.
- Against a freshly installed cluster: `curl -s http://api-server.localhost:4444/api/version` returns the expected JSON shape.
- The endpoint is reachable without an `Authorization` header (auth middleware does not run on it).

### Reviewer checklist

- Endpoint is registered **before** `app.use("/api/*", auth.middleware)` in `app.ts` (no auth on this path).
- `serverVersion` is read at runtime from the deployed package version, not hardcoded in source.
- `minClientVersion` is configurable via Helm without rebuilding the image.
- The route is not a tRPC procedure (no coupling to the `appRouter` / context-creation machinery).
- Default value of `MIN_CLIENT_CLI_VERSION` is `"0.0.0"` so existing/new CLIs aren't surprise-blocked.

## Out of scope (explicit)

- Any CLI code consuming this endpoint (issues 5, 6).
- Authentication of any kind on the endpoint.
- Any additional fields beyond `serverVersion` and `minClientVersion` (e.g. uptime, git SHA, build metadata).
- A version-floor for the *server* (the floor we publish is a CLI floor, not a server self-floor).
- Updating any architecture page (the CLI page lands in issue 2; this endpoint is described there).

## Verification

```sh
mise run check
mise run api-server:test:unit
mise run helm:check:render
mise run cluster:install   # or upgrade if already installed
curl -sv http://api-server.localhost:4444/api/version
# Expected: HTTP 200, JSON body { "serverVersion": "<some semver>", "minClientVersion": "0.0.0" }

# Verify the floor is configurable via Helm:
mise run cluster:kubectl -- set env deployment/platform-apiserver MIN_CLIENT_CLI_VERSION=99.0.0
mise run cluster:kubectl -- rollout status deployment/platform-apiserver
curl -s http://api-server.localhost:4444/api/version | grep -q '"minClientVersion":"99.0.0"'
# Restore:
mise run cluster:kubectl -- set env deployment/platform-apiserver MIN_CLIENT_CLI_VERSION=0.0.0
```

## Reference files

- [`packages/api-server/src/apps/api-server/app.ts`](../../../packages/api-server/src/apps/api-server/app.ts) — registration pattern (`/api/health`, `/api/brand`, `/api/auth/config` are the existing unauthed routes; lines ~109–145).
- [`packages/api-server/src/__tests__/auth.test.ts`](../../../packages/api-server/src/__tests__/auth.test.ts) — Hono test pattern.
- [`packages/api-server/src/config.ts`](../../../packages/api-server/src/config.ts) — env-var schema (Zod) and `configFromEnv` shape.
- [`deploy/helm/platform/templates/apiserver/app.yaml`](../../../deploy/helm/platform/templates/apiserver/app.yaml) — env var propagation in the api-server Deployment.
- [`deploy/helm/platform/values.yaml`](../../../deploy/helm/platform/values.yaml) — `apiServer.*` values.
- [ADR-039](../../adrs/039-cli-foundation.md) §"server-advertised compatibility floor", §"Alternatives Considered → `/version` inside the tRPC surface".
