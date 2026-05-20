# CLI

Last verified: 2026-05-15

## Motivated by

- [ADR-039 — Platform CLI foundation](../adrs/039-cli-foundation.md) — TypeScript Node package distributed via npm; reuses the api-server tRPC contract; flat config under XDG-standard locations; server-advertised compatibility floor.
- [ADR-037 — Remote terminal](../adrs/037-remote-terminal.md) — established the "terminal" session mode; `dam chat` connects the local terminal to it.
- [#73 — Import local project context into agent workspace](https://github.com/dam-agents/dam/issues/73) — the `dam import` verb that uploads local files and folders into an Instance.

## Overview

The `dam` CLI is a TypeScript Node package that users install on their own machine and point at a configured Platform deployment. It never runs inside the cluster. The current surface: `dam --version`, `dam --help` (built-in flags); `dam config set`; `dam ping`; `dam version`; the `dam auth` group (`login`, `logout`, `status`); the `dam instance` group (`list`, `get`, `create`, `delete`, `restart`); the `dam agent` group (`create`); `dam chat`; `dam session list`; `dam template list`; and `dam import`. Command groups are singular to align with `gh`, `git`, and `docker` conventions.

The CLI shares types directly with the api-server via a shared contract package, so server-side type changes reach the CLI without codegen or manual mirroring. Most routes are reached through plain HTTP calls against the api-server's tRPC endpoints; the `dam chat` verb additionally opens a WebSocket to the terminal relay for the interactive PTY session. The auth probes (`/api/auth/config`, OIDC discovery) stay as raw `fetch` because they are not tRPC.

## Trust boundary

The CLI runs on the user's machine. It reads and writes only under the XDG config and state directories (today: `config.toml` under `$XDG_CONFIG_HOME/dam/`; later, credentials under `$XDG_STATE_HOME/dam/`), and makes outbound network calls only to the configured server. There is no telemetry and no anonymous reporting — the platform collects nothing today and the CLI does not break that posture.

## Config

Two persistence concerns are split across the XDG directories: editable configuration (this file, under `$XDG_CONFIG_HOME/dam/`) and credentials (`auth.toml` under `$XDG_STATE_HOME/dam/`, written by `dam auth login`).

- **Location:** `$XDG_CONFIG_HOME/dam/config.toml` (default `~/.config/dam/config.toml`). Flat schema, no profile indirection.
- **Keys:** v0 has one — `server` (URL). Adding a new config key requires registering it at compile time — undeclared keys are a build error.
- **Precedence at resolve time:** flag (per-invocation `--server`, when commands grow one) > env var > file > error. There is no silent default.
- **Env var:** `DAM_SERVER` for the server URL (matches the `dam` binary name). Future keys follow the same `DAM_<KEY>` convention.
- **Writes:** read-merge-rename. The CLI never blows away unrelated top-level keys, so a user can hand-edit comments or future config knobs without losing them on the next `dam config set`.

## Compatibility negotiation

Before any networked verb runs, the CLI hits the api-server's unauthenticated `GET /api/version` (plain HTTP, outside the tRPC surface) to learn the server's version and the minimum CLI version it accepts. Three verdicts:

- **Ok** — local CLI is at or ahead of the server's reported version. Command proceeds.
- **BehindCurrent** — local CLI is below the server but at or above the floor. The CLI warns to stderr and proceeds (exit 0).
- **BelowFloor** — local CLI is below the server's `minClientVersion`. Gated verbs (see below) hard-fail with a non-zero exit; un-gated verbs surface the same verdict but proceed.

When no floor is configured (`minClientVersion` absent from the response), `BelowFloor` is never produced — the CLI proceeds with `Ok` or `BehindCurrent` as if the floor check were skipped.

The floor is configurable via Helm (`apiServer.minClientCliVersion`) so operators can drop support for known-broken older clients without rebuilding the image. `dam ping` and `dam auth login` opt into this gate explicitly; future networked verbs (`shell`, …) will too. `dam version` is the un-gated counterpart to `ping`: it surfaces the same verdict (and the same stderr warnings) but never refuses to run — it is informational, not gated, and always exits 0 even on probe failure.

## Authentication

`dam auth login` authenticates the user against the Active Host's Keycloak realm via the OAuth 2.0 Device Authorization Grant ([RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628)). The realm advertises a public client `platform-cli` (no secret, device grant only) registered in the Helm chart; `/api/auth/config` exposes its id alongside the existing `platform-ui` id so the CLI never hardcodes it.

The flow:

1. Pre-flight `CompatService.check()` — same gate the `ping` verb uses.
2. `GET /api/auth/config` → `{ issuer, clientId, cliClientId }`.
3. `GET <issuer>/.well-known/openid-configuration` → device, token, revocation endpoints.
4. `POST <device endpoint>` → user code + verification URI; CLI prints the URI (and opens the browser unless `--no-browser`).
5. Polling `POST <token endpoint>` with `grant_type=urn:ietf:params:oauth:grant-type:device_code` per RFC 8628 §3.5 (slow_down → +5s, expired_token / access_denied → terminal).
6. On success, persist a per-host record into `$XDG_STATE_HOME/dam/auth.toml` (mode 0600, atomic tmp+rename, read-merge-write to preserve unrelated keys). If `--server` was supplied, persist it as the new active host in `config.toml`.

Credentials are keyed by host URL — the file is a `Map<HostUrl, HostAuth>` shape so switching between Platform deployments doesn't clobber state. `dam auth status` lists every host (active marked), the credential source, and the access-token expiry. **It never prints tokens.** `dam auth logout` best-effort RFC 7009 revokes the refresh token and atomically removes the host's entry — local clear always proceeds even when revocation fails (exit 0, stderr warning). Logout is not OIDC RP-Initiated Logout: the CLI must not kill SSO sessions for unrelated clients (the web UI, federated apps).

The `auth` module exposes a single application service — **`TokenProvider`** — which every future authenticated CLI verb consumes via `getValidAccessToken(host)`. Precedence: `DAM_TOKEN` env var (returned verbatim, no refresh) > Auth Store entry (refreshed proactively within 60s of expiry) > `not-logged-in` error. On a successful refresh the rotated refresh token is persisted atomically; on `invalid_grant` the host's entry is cleared and `session-expired` surfaces so the next command line directs the user to `dam auth login` again.

Concurrent writes to the auth store are not coordinated in v1. The store mutates `auth.toml` via read-merge-rename: the rename is atomic, but the surrounding sequence is not, so two `dam` processes that overlap (e.g. an interactive `dam auth login --server foo` running while a `TokenProvider` refresh for `bar` fires in another terminal) can each persist their own merged snapshot, and the later rename silently reverts the other host's entry. The failure surfaces later as an unexpected `session-expired` prompt — recoverable with `dam auth login`, but on a host the user may not remember touching. Same-host concurrent refreshes cost at most one forced re-login. A proper fix (per-host files or cross-process locking) is deferred — v1 targets solo, single-terminal use.

For headless / CI use, set `DAM_TOKEN=<bearer>` — the CLI uses it verbatim and bypasses `auth.toml`. There is no `--token` flag (avoids leaking tokens into shell history and `ps`).

## Instance addressing

The `instance` module gives users a human-friendly path to address an Instance and exports the seam every future Instance-targeted verb consumes.

- **Instance Ref** — what the user types. Either an Instance ID (anything starting with the Reserved ID Prefix `inst-`) or an Instance name. The split is syntactic; no probe disambiguates them.
- **Resolver policy** — `inst-…` is looked up via `instances.get`; anything else is matched by exact, case-sensitive name against `instances.list`. Zero matches → `not-found`; one → ok; two or more → `ambiguous`. No normalization. No retries. One round-trip per resolution in both branches.
- **Reserved ID Prefix** — the controller mints Instance IDs via `generateK8sName("inst")`. The api-server rejects Instance names beginning with `inst-` at create-time (zod refinement → BAD_REQUEST), eliminating the only ambiguous case.
- **Uniqueness** — `(owner, name)` is unique. Enforced at create-time as a list-then-check (TRPCError CONFLICT). The race window is accepted for CLI traffic; pre-existing duplicates fall through to the resolver's `ambiguous` path.
- **Resolver surface** — `InstanceResolver` is exported from the `instance` module's `index.ts`. Downstream verbs (`dam shell`, …) import it from there and ask the module's compose for an `InstanceService` bound to the resolved Active Host.
- **`EXIT_INSTANCE_NOT_RESOLVED = 5`** — single exit code shared by `not-found` and `ambiguous`; wrapper scripts don't need to branch on "did you mean a different one" vs "no such instance".
- **`--json` parity** — both `list` and `get` emit raw `Instance` / `Instance[]` from the contract. Empty list is `[]`, never `null`.

## Instance lifecycle

The CLI presents Instances as single, atomic entities. The server-side Agent ↔ Instance 1:N split (an Agent is a template-bound desired spec; an Instance is a running pod derived from one) is intentionally hidden — `dam instance create` orchestrates the agent and the instance as a pair, and `dam instance delete` tears them down together: the normal path cascades through the Agent's OwnerReferences (matching the web UI); orphaned Instances fall back to a direct Instance delete so they don't get stranded.

- **Create** issues `agents.create` followed by `instances.create` as a single user-facing action. Env vars and description attach to the **agent** (matching UI behavior, so subsequent UI edits land where the user expects). When `instances.create` fails with a TRPCError code that represents a definitive server rejection (`CONFLICT`, `BAD_REQUEST`, `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `PRECONDITION_FAILED`, `UNIMPLEMENTED`, `RESOURCE_EXHAUSTED`), the CLI attempts a single 10-second rollback of the agent so partial failures don't leak orphans. Ambiguous failures (network, `INTERNAL_SERVER_ERROR`) leave the agent and surface a hint pointing at the orphan, because the instance may have been created and silently rolling back would destroy real state.
- **Delete** branches on whether the Instance still has a backing Agent. The normal path calls `agents.delete(agentId)` and the Kubernetes garbage collector cascades through to the Instance ConfigMap and any owned PVCs — the same flow the web UI's "delete agent" button uses. When the Agent is already gone (`templateId === null` in the projection, surfaced server-side via the orphan-agent-reference warning), the cascade can't fire, so the CLI falls back to `instances.delete(id)` and removes the Instance ConfigMap directly. Delete confirms by default; `--yes` bypasses the prompt and is required on non-TTY stdin.
- **Restart** calls `instances.restart(id)`, which deletes pod-0 of the StatefulSet. The controller recreates the pod with the current spec; persistent volumes (the home mount and any template-declared `persist: true` mounts) survive.
- **`--wait`** on `create` and `restart` polls `instances.get` every 2 seconds and settles on `state === "running"` (success) or `state === "error"` (terminal). `restart --wait` sleeps 2 seconds before the first poll so the controller has time to observe the pod deletion — otherwise the first poll might see stale `running` state from the doomed pod. Default timeout is 120 seconds; on timeout the instance is left as-is (no rollback) and the command exits non-zero. Under `--json`, every exit path emits a valid `Instance` payload on stdout: the success branch reuses the snapshot the wait loop already observed, and the timeout / non-wait branches refresh via `instances.get` with a fallback to the post-mutation snapshot if the refresh fails, so scripted callers never see empty stdout.

`dam template list` exposes the agent templates the operator has installed on the active host (the `claude-code`, `pi-agent`, etc. ConfigMaps the controller reads at boot). Templates are read-only from the CLI's perspective; operators add or remove them via Helm.

## Interactive agent setup

`dam agent create` is the interactive complement to `dam instance create`. It walks the user through name → template → model provider → optional GitHub PAT in a single TTY-bound flow and ends with the same agent + instance + grants that the web UI's "Add agent" dialog produces. The scripted entry point is unchanged — `dam instance create <name> --template <id>` stays the path for shell scripts and CI, and `dam agent create` refuses to run when stdin is not a TTY (pointing the caller back at `instance create`).

Each step lines up with one server-side mutation, in the same order the web UI's `useCreateAgent` runs them:

1. **Model provider** — singleton per type (Anthropic, IBM LiteLLM, OpenAI), matching the web UI's provider cards. The picker lists existing provider Secrets and offers "Add new..."; the add-new sub-flow auto-names the Secret with `PROVIDERS[type].displayName` and routes through `secrets.create`. If a Secret of the chosen type already exists, the flow offers to replace its value (`secrets.update`) instead of duplicating.
2. **GitHub PAT** *(optional)* — a single PAT is two `generic` Secrets (see [security-and-credentials.md](security-and-credentials.md#credential-storage)); the picker groups them client-side and hides orphans. New PATs go through `secrets.createGithubPat`, which creates both halves atomically server-side.
3. **`agents.create` → `instances.create` → `secrets.setAgentAccess`** — grants are persisted as `granted-secret-ids` annotations on the *instance* ConfigMap, so the grant call has to come after `instances.create`. `setAgentAccess` runs inside a 5× / 2s retry to bridge the K8s-API visibility race for the just-created ConfigMap. The controller rolls the pod once when the grant lands; one rolling restart per agent is the cost.
4. **Wait for `running`** — same 120 s timeout the `instance --wait` path uses. Timeout is success (the instance exists, the pod is slow); pod-failure state and Ctrl+C during the wait exit non-zero without rolling back.

Anything created during the run (new provider Secret, new GitHub PAT pair, the agent) is tracked in a small ledger; a failure in any of the post-prompt mutations triggers one cleanup pass — `agents.delete` cascade-tears-down the instance and its grants, then any new Secrets are deleted by id. Picked-existing and replace-existing paths stay out of the ledger: the replace path overwrote the value in place, and the old value is unrecoverable. Anything the cleanup itself can't delete surfaces as an orphan summary so the user knows what to remove manually.

The post-success hint points at `dam chat <name>` (the chat verb is a future module). Interrupting at any prompt before the mutation chain exits cleanly with no orphans; interrupting during the wait leaves the agent in place with the same delete-hint, on the basis that the user chose to interrupt and the agent's existence is their call from there.

## Terminal attach

`dam chat <instance>` connects the user's local terminal to a running instance's interactive TUI over a WebSocket, using the same binary terminal frame protocol ([ADR-037](../adrs/037-remote-terminal.md)) that the UI's terminal mode uses. The command requires an interactive TTY (stdin must be a TTY; piped input is rejected) and puts stdin into raw mode for the duration of the session so keystrokes — including Ctrl+C — pass through to the remote harness rather than being intercepted locally.

Three session strategies:

- **New** (default) — creates a new terminal-mode session via the sessions API, then connects.
- **Continue** (`--continue`) — finds the most recent terminal-mode session for the instance. Errors if zero or more than one terminal session exists.
- **Resume** (`--resume <session-id>`) — targets a specific session by ID. If the target session is in chat mode, the CLI prompts the user to confirm a mode switch to terminal before proceeding; declining exits cleanly.

Strategy resolution happens server-side: the CLI calls a single `sessions.resolveTerminal` tRPC mutation with the strategy and receives back either a ready result (session ID + relative WebSocket path) or a decision prompt (`confirm-mode-switch`, `no-terminal-session`, etc.). This keeps the CLI a thin orchestrator — it never lists sessions to decide which one to connect to, and the URL construction for the terminal relay lives entirely in the api-server.

The `--reset` flag can combine with any strategy — it tells the api-server's terminal relay to kill the existing PTY and spawn a fresh one, which also triggers `resetSession` on the agent-runtime to close the agent-side ACP session and clear its log.

On disconnect, the CLI prints the session ID and a ready-to-paste `dam chat --resume` command so the user can reattach.

`dam session list <instance>` lists all sessions for an instance, showing session ID, mode, type, and creation time. The `--json` flag emits raw JSON for scripted consumption.

The chat module uses the same tRPC client infrastructure as the rest of the CLI (`@trpc/client` with `httpBatchLink` and bearer auth), composing a per-host `SessionsPort` for session CRUD and terminal resolution. The terminal bridge owns the raw TTY ↔ WebSocket lifecycle — it receives a server-provided `terminalPath` and constructs the full WebSocket URL locally, sending the auth token via an `Authorization: Bearer` header. Both are injected through the module's compose root alongside the shared Token Provider and Instance Resolver seams.

## Import

`dam import <instance-ref> <path...>` uploads one or more local files or folders into an Instance. The verb consumes the Token Provider seam from `auth`, the `createInstanceResolver` factory from the `instance` module's `index.ts`, and the same `CompatService` / `ConfigService` gates every networked verb uses.

- **Wire shape** — POST `<server>/api/instances/<id>/import`, multipart/form-data with one part `bundle: application/gzip`. Bearer auth. Same contract the UI's [`importBundle`](../../packages/ui/src/modules/files/api/import-bundle.ts) targets; the server-side design rationale lives in [ADR-044](../adrs/044-file-import.md).
- **Each path argument becomes one top-level entry** under `work/` on the Instance, named by its `basename(path)`. `dam import foo CLAUDE.md .claude src` lands at `work/CLAUDE.md`, `work/.claude/`, `work/src/`. The on-pod `finalize` ([packages/agent-runtime/src/modules/import/finalize.ts](../../packages/agent-runtime/src/modules/import/finalize.ts)) replaces each top-level entry atomically; other entries under `work/` are untouched.
- **Bundle** — a single gzipped tar built from the supplied paths with [`tar-stream`](https://github.com/mafintosh/tar-stream) and spooled to a tmpfile. Sent as a `FormData` `Blob` via Node's `openAsBlob` so undici computes `Content-Length` correctly (the server requires it). Symlinks anywhere in the imported tree are skipped (not followed). Excluded basenames at every level: `node_modules`, `.venv`, `__pycache__`, `.DS_Store` — same set the UI uses; rendered into `dam import --help` from the single source of truth.
- **Tmpdir lifecycle** — `$TMPDIR/dam-import-*` is created up front and torn down by an awaited `cleanup()` after upload. A SIGINT handler is installed alongside the tmpdir and removed by `cleanup()`; on Ctrl+C during pack or upload the handler does a synchronous best-effort rm and exits 130, since the default SIGINT termination skips `finally` blocks.
- **Top-level replace is destructive** at each named path. The CLI shows a TTY confirm prompt before any upload; `--yes` skips. Non-TTY without `--yes` refuses (exit 2). Cancelled-by-user prints `Cancelled.` to stdout (or `{"cancelled":true}` under `--json`), exit 0.
- **No service layer** — the verb has a single POST with status-based classification, so the action handler classifies inline (`switch (res.status)`) rather than introducing a port the way `instance` does for tRPC.
