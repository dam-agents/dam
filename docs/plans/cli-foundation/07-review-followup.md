# Issue 7 — PR #121 review follow-ups (round 1)

**Depends on:** 1, 5, 6
**Blocks:** —
**Tracks:** [PR #121 review](https://github.com/dam-agents/dam/pull/121) by @tomkis

## Context

PR [#121](https://github.com/dam-agents/dam/pull/121) — the [ADR-039](../../adrs/039-cli-foundation.md) CLI foundation — was reviewed with `CHANGES_REQUESTED`. Two of the threads (server-version build-time embed, reverse the version-check direction, drop `docs/plans/`) and one (CLI domain switching to Zod) need design conversations and are deferred. This issue lands the **round-1 fixes** that are clear, low-blast-radius, and unblock the merge:

- **R3.** Inline the `/api/version` registration; drop the artificial separate handler and its unit test.
- **R4a.** Make the server's `minClientCliVersion` optional rather than defaulting to the cryptic `0.0.0` sentinel. Propagate the optionality through the response shape and the CLI's verdict logic.
- **R6.** Replace the hand-rolled response type guard in the CLI's `VersionProbe` with a Zod schema (project-wide convention).
- **R7+R8.** Trim the `architecture.md` index entry for the CLI page so it stops naming volatile mechanism (the floor and the on-disk path).

**Why now:** these are review-blocking items the team agrees on; landing them shrinks the diff that needs further debate down to the genuinely-architectural threads.

**Out of scope** (separate threads, separate plans):

- R1 / R5: api-server `serverVersion` IIFE → build-time embed pattern.
- R2: whether `serverVersion` belongs inside `Config`.
- R4b: reversing the version-check direction (client-driven instead of server-advertised). Touches ADR-039.
- PR-A: replacing the CLI's hand-rolled config domain (key registry + per-key validators + shape picker) with Zod.
- PR-B: deleting `docs/plans/cli-foundation/` once we audit it.

## Scope

### R3 — collapse `version.ts` into `app.ts`

**File deletes:**

- `packages/api-server/src/apps/api-server/version.ts`
- `packages/api-server/src/__tests__/unit/version.test.ts`

**Edit `packages/api-server/src/apps/api-server/app.ts`:**

- Remove the `import { registerVersionEndpoint } …` line.
- Replace the `registerVersionEndpoint(app, …)` call (currently lines 111–114) with the inlined four lines:
  ```ts
  app.get("/api/version", (c) =>
    c.json({
      serverVersion,
      ...(config.minClientCliVersion !== undefined && {
        minClientVersion: config.minClientCliVersion,
      }),
    }),
  );
  ```
  (The conditional-spread is the R4a-driven shape change — see below.)

The inlined form sits next to the other public endpoints (`/api/health`, `/api/auth/config`, `/api/brand`) and matches their shape. No new tests — the integration paths in `cli/src/__tests__/version.integration.test.ts` and `cli/src/__tests__/ping.integration.test.ts` already exercise the endpoint end-to-end.

### R4a — `minClientCliVersion`: optional, not `0.0.0`

**Server side:**

- `packages/api-server/src/config.ts:48` — change `minClientCliVersion: z.string().default("0.0.0")` to `minClientCliVersion: z.string().optional()`. The `loadConfig` parse call at the bottom of the same file already passes `process.env.MIN_CLIENT_CLI_VERSION`; an empty string from Helm should also normalize to `undefined` — handle by passing `process.env.MIN_CLIENT_CLI_VERSION || undefined` (mirrors how other optional string envs are handled).
- `packages/api-server/src/apps/api-server/app.ts` — see R3 above; the response omits `minClientVersion` when the floor is unset.
- **No code change** in `index.ts` — `serverVersion` plumbing is unchanged.

**Helm side:**

- `deploy/helm/platform/values.yaml:269` — change `minClientCliVersion: "0.0.0"` to `minClientCliVersion: ""` and update the comment block (lines 264–268) to:
  ```yaml
  # -- Minimum dam CLI version this server accepts (semver, e.g. "1.2.0").
  # Empty/unset means no floor — every CLI is accepted (a soft-warn fires
  # if the CLI is behind the current server version). Set this to retire a
  # known-broken older client. See ADR-039 §"server-advertised compatibility floor".
  minClientCliVersion: ""
  ```
- `deploy/helm/platform/templates/apiserver/app.yaml:84-85` — the existing two-line block sets `MIN_CLIENT_CLI_VERSION` unconditionally. Wrap it in `{{- if .Values.apiServer.minClientCliVersion }}` so an empty value omits the env var entirely (consistent with the `slackBotToken` pattern at lines 86–89).

**CLI side:**

- `packages/cli/src/modules/cli/infrastructure/version-probe.ts` — see R6; the Zod schema makes `minClientVersion` optional.
- `packages/cli/src/modules/cli/services/compat-service.ts` — pass `serverMinClient: probed.value.minClientVersion` through unchanged; the field is now `string | undefined`. Update the call to `verdictFor`.
- `packages/cli/src/modules/cli/domain/compat.ts`:
  - Change `serverMinClient: string` → `serverMinClient: string | undefined` on `VerdictInputs` and on each `CompatVerdict` variant.
  - In `verdictFor`: when `serverMinClient === undefined`, skip the `below-floor` branch entirely — go straight to the `behind-current` / `ok` comparison.
  - The verdict types should keep `serverMinClient` in their payloads (commands print it when present); narrow it to `string | undefined`.
- `packages/cli/src/modules/cli/commands/ping.ts` and `version.ts` — wherever they format `serverMinClient` for output, guard with `?? <fallback>` or skip the line. The existing "min CLI" line should be omitted when the floor is unset; do not print "min CLI undefined" or "min CLI 0.0.0".

### R6 — Zod in `VersionProbe`

**Edit `packages/cli/src/modules/cli/infrastructure/version-probe.ts`:**

- Add `import { z } from "zod/v4";` (matches api-server convention).
- Replace the hand-rolled `isVersionInfo` type guard (lines 87–95) with:
  ```ts
  const versionInfoSchema = z.object({
    serverVersion: z.string(),
    minClientVersion: z.string().optional(),
  });
  ```
- In `probe`, replace the `if (!isVersionInfo(body))` block with `versionInfoSchema.safeParse(body)`; on failure, return `err({ kind: "probe-error", code: "malformed-response", message: <flattened-zod-error> })`.
- The `VersionInfo` interface becomes `type VersionInfo = z.infer<typeof versionInfoSchema>;`.

The error code (`"malformed-response"`) and shape stay the same — existing tests pass unchanged for the body-fields case. Only the *message* string differs (Zod's flattened output vs. the literal `"response missing serverVersion or minClientVersion"`); update the matching test assertion.

### R7 + R8 — `docs/architecture.md` line 60

**Edit `docs/architecture.md:60`:**

- Replace:
  ```
  - [cli](architecture/cli.md) — `dam` command-line client (TypeScript Node package on npm), config under `~/.dam/`, server-advertised compatibility floor.
  ```
  with:
  ```
  - [cli](architecture/cli.md) — `dam` command-line client, an npm-distributed Node package that points at a configured Platform deployment.
  ```

The replaced text drops two volatile mechanism details (the on-disk path — already wrong per the [XDG-paths issue](../issues/cli-xdg-paths.md) — and the floor mechanism, which is being debated in [PR #121](https://github.com/dam-agents/dam/pull/121) thread R4b). Per [documentation-guidelines.md](../guidelines/documentation-guidelines.md), the index entry should hold framework-level orientation only; mechanism stays in `architecture/cli.md` and the ADR.

## Tests

- `mise run check` — typecheck must stay green; the `serverMinClient: string | undefined` propagation is the only place this could surface.
- `mise run test` — all packages.
- `mise run api-server:test:unit` — must drop from 227 to 226 (the deleted `version.test.ts` test file removes 2 tests, but the integration tests cover the endpoint).
- `mise run cli:test` — must stay 73/73. The `version-probe.test.ts` "missing fields → Err(probe-error, malformed-response)" assertion needs its `expect(r.error.message).toContain("missing")` softened to `expect(r.error.code).toBe("malformed-response")` — Zod's message wording is different.
- Add **one new** `version-probe.test.ts` case: 200 OK with `minClientVersion` field absent → `Ok` with `value.minClientVersion === undefined`. This locks in the optional-floor contract.
- Add **one new** `compat.test.ts` case: `verdictFor({ localCli: "1.0.0", serverVersion: "2.0.0", serverMinClient: undefined })` returns `kind: "behind-current"` (not `"below-floor"`). Belt-and-braces against a regression where `undefined < anything` evaluates to `false` and the floor branch quietly disappears.
- `mise run helm:check:render` + `mise run helm:check:lint` — must pass; the conditional `MIN_CLIENT_CLI_VERSION` wrap is the only template change.

## Acceptance criteria

- `mise run check` passes.
- `mise run test` passes.
- `mise run helm:check:render` + `mise run helm:check:lint` pass.
- `version.ts` and `version.test.ts` are deleted.
- `GET /api/version` against a default-Helm install (empty `minClientCliVersion`) returns `{ "serverVersion": "<version>" }` with **no `minClientVersion` field**.
- `GET /api/version` against a Helm install with `minClientCliVersion: "1.0.0"` returns both fields.
- `dam ping` against a no-floor server: succeeds (exit 0) regardless of CLI version.
- `dam version` against a no-floor server: prints local + server version, **no "min CLI" line**, exit 0.
- `dam ping` against a floor-set server with the local CLI below the floor: still exits non-zero with the below-floor error (no regression on the gate).
- `docs/architecture.md:60` no longer names `~/.dam/` or "server-advertised compatibility floor".

### Reviewer checklist

- The conditional-spread on the response object is correct — `minClientVersion` key absent (not `null`, not `""`) when unset.
- The Helm `if` block follows the existing style (e.g. `slackBotToken` at app.yaml:86).
- Compat-domain verdict types correctly express "no floor advertised" (i.e. `serverMinClient` is `string | undefined`, not always present-but-empty).
- `dam version` and `dam ping` output stays clean when the floor is absent — no "min CLI undefined", no blank parenthetical.
- No mention of `0.0.0` survives in code, comments, or docs — grep confirms.

## Out of scope (explicit)

- Build-time embed for the api-server's `serverVersion` (R1, R5) — separate plan.
- Folding `serverVersion` into `Config` (R2) — separate thread.
- Reversing the version-check direction (R4b) — needs ADR-039 amendment.
- Replacing the CLI's hand-rolled config domain with Zod (PR-A) — separate plan; relaxes the spec's "domain has zero outside imports" rule.
- Deleting `docs/plans/cli-foundation/` (PR-B) — needs an audit pass first.
- The XDG path migration ([cli-xdg-paths.md](../issues/cli-xdg-paths.md)) — its own issue.

## Verification

```sh
mise run check
mise run test
mise run helm:check:lint
mise run helm:check:render
mise run cli:build

# Default Helm install — no floor configured:
mise run cluster:install
curl -s http://api-server.localhost:4444/api/version | jq .
# expect: { "serverVersion": "<version>" }   — no minClientVersion key

# With a floor set:
mise run cluster:kubectl -- set env deployment/platform-apiserver MIN_CLIENT_CLI_VERSION=1.0.0
mise run cluster:kubectl -- rollout status deployment/platform-apiserver
curl -s http://api-server.localhost:4444/api/version | jq .
# expect: { "serverVersion": "<version>", "minClientVersion": "1.0.0" }

# CLI behavior with no floor:
TMPHOME=$(mktemp -d)
mise run cluster:kubectl -- set env deployment/platform-apiserver MIN_CLIENT_CLI_VERSION-
mise run cluster:kubectl -- rollout status deployment/platform-apiserver
HOME=$TMPHOME node packages/cli/dist/bin.js config set server http://api-server.localhost:4444
HOME=$TMPHOME node packages/cli/dist/bin.js version   # no "min CLI" line
HOME=$TMPHOME node packages/cli/dist/bin.js ping      # exit 0

# CLI behavior with floor below local:
mise run cluster:kubectl -- set env deployment/platform-apiserver MIN_CLIENT_CLI_VERSION=99.0.0
mise run cluster:kubectl -- rollout status deployment/platform-apiserver
HOME=$TMPHOME node packages/cli/dist/bin.js ping; echo "exit=$?"   # expect non-zero, below-floor error

# Cleanup:
mise run cluster:kubectl -- set env deployment/platform-apiserver MIN_CLIENT_CLI_VERSION-
```

## Reference files

- [PR #121 review thread](https://github.com/dam-agents/dam/pull/121) — the source comments.
- [ADR-039](../../adrs/039-cli-foundation.md) §"server-advertised compatibility floor" — the rule R4a refines (optional ≠ removed).
- Issue [01-server-version-endpoint.md](01-server-version-endpoint.md) — the endpoint contract being trimmed.
- Issue [05-compat-and-ping-command.md](05-compat-and-ping-command.md) — the gate behavior R4a must not regress.
- [docs/guidelines/documentation-guidelines.md](../guidelines/documentation-guidelines.md) — the rule R7+R8 lean on.
