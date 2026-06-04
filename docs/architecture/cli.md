# CLI

Last verified: 2026-06-03

## Motivated by

- [ADR-039 — Platform CLI foundation](../adrs/039-cli-foundation.md) — TypeScript Node package distributed via npm; reuses the api-server tRPC contract; flat config under XDG-standard locations; server-advertised compatibility floor.
- [ADR-037 — Remote terminal](../adrs/037-remote-terminal.md) — established the "terminal" session mode; `dam chat` connects the local terminal to it.
- [#73 — Import local project context into agent workspace](https://github.com/dam-agents/dam/issues/73) — the `dam import` verb that uploads local files and folders into an Agent.
- [#254 — Granular file ops over the agent-runtime proxy](https://github.com/dam-agents/dam/issues/254) — the `dam file` group (`get`, `put`, `list`) for single-file workspace operations.
- [ADR-046 — Eliminate Instance, collapse into Agent](../adrs/046-eliminate-instance.md) — the CLI addresses Agents (not Instances); a single `dam agent` group covers the lifecycle.
- [ADR-035 — Unified HITL UX](../adrs/035-unified-hitl-ux.md) — the per-Agent network access pre-approvals that the `dam network` group lists and mutates ([#345](https://github.com/dam-agents/dam/issues/345), a P0 sub-issue of [#329](https://github.com/dam-agents/dam/issues/329)).
- [#344 — Manage OAuth connections from the CLI](https://github.com/dam-agents/dam/issues/344) — the `dam connection` group that lists, grants, revokes, and disconnects Connections (OAuth apps and MCP servers) for an Agent (a P0 sub-issue of [#329](https://github.com/dam-agents/dam/issues/329)); the connection/contribution model is [ADR-051](../adrs/051-connections-and-contributions.md), credential injection is [ADR-033](../adrs/033-envoy-credential-gateway.md).
- [#418 — Create OAuth connections from the CLI](https://github.com/dam-agents/dam/issues/418) — the `dam connection connect` verb that creates a Connection from a template (closing the one gap #344 left), including the browser OAuth round-trip and the server-side `connectedAt` completion signal it polls on.
- [#419 — Manage MCP server connections from the CLI](https://github.com/dam-agents/dam/issues/419) — extends `dam connection connect` to accept an MCP server URL, discovering auth via `connections.discoverMcp` and reusing the same create/poll flow (a P0 sub-issue of [#329](https://github.com/dam-agents/dam/issues/329)).
- [#448 — List available connection providers from the CLI](https://github.com/dam-agents/dam/issues/448) — the `dam connection templates` verb that lists the connection catalog a Connection can be created from, closing the list-then-connect discovery gap left by #418/#419 (CLI-only setup no longer needs the web UI to learn a valid `connect <id>` argument).

## Overview

The `dam` CLI is a TypeScript Node package that users install on their own machine and point at a configured Platform deployment. It never runs inside the cluster. The current surface: `dam --version`, `dam --help` (built-in flags); `dam config set`; `dam ping`; `dam version`; the `dam auth` group (`login`, `logout`, `status`); the `dam agent` group (`list` [default], `get`, `create`, `create-interactive`, `delete`, `restart`); `dam chat`; `dam session list`; `dam template list`; `dam import`; the `dam file` group (`get`, `put`, `list`); the `dam network` group (`list`, `create`, `update`, `revoke`, `preset`, `apply-preset`, `trusted-hosts`); and the `dam connection` group (`list`, `templates`, `connect`, `disconnect`, `grant`, `revoke`). Command groups are singular to align with `gh`, `git`, and `docker` conventions.

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

## Agent addressing

The `agent` module gives users a human-friendly path to address an Agent and exports the seam every Agent-targeted verb consumes.

- **Agent Ref** — what the user types. Either an Agent ID (anything starting with the Reserved ID Prefix `agent-`) or an Agent name. The split is syntactic; no probe disambiguates them.
- **Resolver policy** — `agent-…` is looked up via `agents.get`; anything else is matched by exact, case-sensitive name against `agents.list`. Zero matches → `not-found`; one → ok; two or more → `ambiguous`. No normalization. No retries. One round-trip per resolution in both branches.
- **Reserved ID Prefix** — the controller mints Agent IDs via `generateK8sName("agent")`. The api-server rejects Agent names beginning with `agent-` at create-time (zod refinement → BAD_REQUEST), eliminating the only ambiguous case.
- **Uniqueness** — `(owner, name)` is unique. Enforced at create-time as a list-then-check (TRPCError CONFLICT). The race window is accepted for CLI traffic; pre-existing duplicates fall through to the resolver's `ambiguous` path.
- **Resolver surface** — `AgentResolver` is exported from the `agent` module's `index.ts`. Downstream verbs (`dam chat`, `dam import`, `dam file`, …) import it from there and ask the module's compose for an `AgentService` bound to the resolved Active Host.
- **`EXIT_AGENT_NOT_RESOLVED = 5`** — single exit code shared by `not-found` and `ambiguous`; wrapper scripts don't need to branch on "did you mean a different one" vs "no such agent".
- **`--json` parity** — both `list` and `get` emit raw `Agent` / `Agent[]` from the contract. Empty list is `[]`, never `null`.

## Agent lifecycle

The CLI presents Agents as single, atomic entities — which they are after [ADR-046](../adrs/046-eliminate-instance.md) collapsed the former Agent/Instance pair into a single Agent ConfigMap carrying both spec and runtime state.

- **Create** issues a single `agents.create` mutation. Env vars and description attach directly to the agent payload. There is no second hop and no rollback logic — the merged Agent CM is provisioned atomically server-side.
- **Delete** calls `agents.delete(id)`. The Kubernetes garbage collector cascades through the Agent CM's OwnerReferences to the StatefulSet, Service, NetworkPolicy, and any owned PVCs — the same flow the web UI's "delete agent" button uses. Delete confirms by default; `--yes` bypasses the prompt and is required on non-TTY stdin.
- **Restart** calls `agents.restart(id)`, which deletes pod-0 of the agent's StatefulSet. The controller recreates the pod with the current spec; persistent volumes (the home mount and any template-declared `persist: true` mounts) survive.
- **`--wait`** on `create` and `restart` polls `agents.get` every 2 seconds and settles on `state === "running"` (success) or `state === "error"` (terminal). `restart --wait` sleeps 2 seconds before the first poll so the controller has time to observe the pod deletion — otherwise the first poll might see stale `running` state from the doomed pod. Default timeout is 120 seconds; on timeout the agent is left as-is (no rollback) and the command exits non-zero. Under `--json`, every exit path emits a valid `Agent` payload on stdout: the success branch reuses the snapshot the wait loop already observed, and the timeout / non-wait branches refresh via `agents.get` with a fallback to the post-mutation snapshot if the refresh fails, so scripted callers never see empty stdout.

`dam template list` exposes the agent templates the operator has installed on the active host (the `claude-code`, `pi-agent`, etc. ConfigMaps the controller reads at boot). Templates are read-only from the CLI's perspective; operators add or remove them via Helm.

## Interactive agent setup

`dam agent create-interactive` is the interactive complement to `dam agent create`. It walks the user through name → template → model provider → optional GitHub PAT in a single TTY-bound flow and ends with the same agent + grants that the web UI's "Add agent" dialog produces. The scripted entry point is unchanged — `dam agent create <name> --template <id>` stays the path for shell scripts and CI, and `dam agent create-interactive` refuses to run when stdin is not a TTY (pointing the caller back at `agent create`).

Each step lines up with one server-side mutation, in the same order the web UI's `useCreateAgent` runs them:

1. **Model provider** — singleton per type (Anthropic, IBM LiteLLM, OpenAI), matching the web UI's provider cards. The picker lists existing provider Secrets and offers "Add new..."; the add-new sub-flow auto-names the Secret with `PROVIDERS[type].displayName` and routes through `secrets.create`. If a Secret of the chosen type already exists, the flow offers to replace its value (`secrets.update`) instead of duplicating.
2. **GitHub PAT** *(optional)* — a single PAT is two `generic` Secrets (see [security-and-credentials.md](security-and-credentials.md#credential-storage)); the picker groups them client-side and hides orphans. New PATs go through `secrets.createGithubPat`, which creates both halves atomically server-side.
3. **`agents.create` → `secrets.setAgentAccess`** — grants are persisted as `granted-secret-ids` annotations on the *agent* ConfigMap, so the grant call has to come after `agents.create`. `setAgentAccess` runs inside a 5× / 2s retry to bridge the K8s-API visibility race for the just-created ConfigMap. The controller rolls the pod once when the grant lands; one rolling restart per agent is the cost.
4. **Wait for `running`** — same 120 s timeout the `agent create --wait` path uses. Timeout is success (the agent exists, the pod is slow); pod-failure state and Ctrl+C during the wait exit non-zero without rolling back.

Anything created during the run (new provider Secret, new GitHub PAT pair, the agent) is tracked in a small ledger; a failure in any of the post-prompt mutations triggers one cleanup pass — `agents.delete` cascade-tears-down the agent and its grants, then any new Secrets are deleted by id. Picked-existing and replace-existing paths stay out of the ledger: the replace path overwrote the value in place, and the old value is unrecoverable. Anything the cleanup itself can't delete surfaces as an orphan summary so the user knows what to remove manually.

The post-success hint points at `dam chat <name>`. Interrupting at any prompt before the mutation chain exits cleanly with no orphans; interrupting during the wait leaves the agent in place with the same delete-hint, on the basis that the user chose to interrupt and the agent's existence is their call from there.

## Terminal attach

`dam chat <agent>` connects the user's local terminal to a running agent's interactive TUI over a WebSocket, using the same binary terminal frame protocol ([ADR-037](../adrs/037-remote-terminal.md)) that the UI's terminal mode uses. The command requires an interactive TTY (stdin must be a TTY; piped input is rejected) and puts stdin into raw mode for the duration of the session so keystrokes — including Ctrl+C — pass through to the remote harness rather than being intercepted locally.

Three session strategies:

- **New** (default) — mints a fresh session id locally and connects; the PTY creates the session on attach. It surfaces in `session/list` with no `_meta` and decodes as terminal.
- **Continue** (`--continue`) — finds the most recent terminal-mode session for the agent. Errors if zero or more than one terminal session exists.
- **Resume** (`--resume <session-id>`) — targets a specific session by ID. If the target session is in chat mode, the CLI prompts the user to confirm a mode switch to terminal before proceeding; declining exits cleanly.

Strategy resolution happens **client-side** ([ADR-055](../adrs/055-agent-owned-session-metadata.md)): sessions are agent-owned, so the CLI lists them over its own ACP connection to the api-server relay (decoding `_meta.platform`) and resolves the strategy locally — minting an id for `new`, matching terminal-mode sessions for `continue`, looking up the id for `resume` — then builds the terminal-relay URL itself. A confirmed chat→terminal switch is persisted over ACP (`session/resume` carrying `_meta.platform.mode`). There is no server-side session endpoint.

The `--reset` flag can combine with any strategy — it tells the api-server's terminal relay to kill the existing PTY and spawn a fresh one, which also triggers `resetSession` on the agent-runtime to close the agent-side ACP session and clear its log.

On disconnect, the CLI prints the session ID and a ready-to-paste `dam chat --resume` command so the user can reattach.

`dam session list <agent>` lists all sessions for an agent, showing session ID, mode, type, and creation time. The `--json` flag emits raw JSON for scripted consumption.

The chat module composes a per-host `SessionsPort` backed by a small ACP client (`@agentclientprotocol/sdk` over the relay WebSocket) that lists sessions and persists mode changes; agent resolution and auth still use the shared tRPC client. The terminal bridge owns the raw TTY ↔ WebSocket lifecycle — it receives the `terminalPath` the port built and constructs the full WebSocket URL locally, sending the auth token as a `token` query parameter. Both are injected through the module's compose root alongside the shared Token Provider and Agent Resolver seams.

## Import

`dam import <agent-ref> <path...>` uploads one or more local files or folders into an Agent. The verb consumes the Token Provider seam from `auth`, the `createAgentResolver` factory from the `agent` module's `index.ts`, and the same `CompatService` / `ConfigService` gates every networked verb uses.

- **Wire shape** — POST `<server>/api/agents/<id>/import`, multipart/form-data with one part `bundle: application/gzip`. Bearer auth. Same contract the UI's [`importBundle`](../../packages/ui/src/modules/files/api/import-bundle.ts) targets; the server-side design rationale lives in [ADR-045](../adrs/045-file-import.md).
- **Each path argument becomes one top-level entry** under `work/` on the Agent, named by its `basename(path)`. `dam import foo CLAUDE.md .claude src` lands at `work/CLAUDE.md`, `work/.claude/`, `work/src/`. The on-pod `finalize` ([packages/agent-runtime/src/modules/import/finalize.ts](../../packages/agent-runtime/src/modules/import/finalize.ts)) replaces each top-level entry atomically; other entries under `work/` are untouched.
- **Bundle** — a single gzipped tar built from the supplied paths with [`tar-stream`](https://github.com/mafintosh/tar-stream) and spooled to a tmpfile. Sent as a `FormData` `Blob` via Node's `openAsBlob` so undici computes `Content-Length` correctly (the server requires it). Symlinks anywhere in the imported tree are skipped (not followed). Excluded basenames at every level: `node_modules`, `.venv`, `__pycache__`, `.DS_Store` — same set the UI uses; rendered into `dam import --help` from the single source of truth.
- **Tmpdir lifecycle** — `$TMPDIR/dam-import-*` is created up front and torn down by an awaited `cleanup()` after upload. A SIGINT handler is installed alongside the tmpdir and removed by `cleanup()`; on Ctrl+C during pack or upload the handler does a synchronous best-effort rm and exits 130, since the default SIGINT termination skips `finally` blocks.
- **Top-level replace is destructive** at each named path. The CLI shows a TTY confirm prompt before any upload; `--yes` skips. Non-TTY without `--yes` refuses (exit 2). Cancelled-by-user prints `Cancelled.` to stdout (or `{"cancelled":true}` under `--json`), exit 0.
- **No service layer** — the verb has a single POST with status-based classification, so the action handler classifies inline (`switch (res.status)`) rather than introducing a port the way `agent` does for tRPC.

## Files

`dam file get <ref> <remote-path>` / `dam file put <ref> <local-path> <remote-path>` / `dam file list <ref> [<remote-path>]` are granular, non-destructive counterparts to `dam import`. Each verb operates on a single file in an Agent's workspace and consumes the existing api-server proxy at `/api/agents/<id>/trpc/files.*` — the same surface the web UI's file browser uses (see [packages/agent-runtime/src/modules/files.ts](../../packages/agent-runtime/src/modules/files.ts) for the underlying service, and [packages/api-server/src/apps/api-server/app.ts](../../packages/api-server/src/apps/api-server/app.ts) for the catch-all proxy that fronts it). No new server-side surface is introduced.

- **Wire shape** — a per-agent tRPC client typed against `agent-runtime-api`'s `AppRouter` and pointed at `<server>/api/agents/<id>/trpc`. Bearer auth via the shared Token Provider; ownership is verified at the proxy boundary in api-server. Verbs reuse the same `CompatService` / `ConfigService` gates and `AgentResolver` as every other Agent-targeted CLI verb.
- **`get`** — one `files.read.query({ path })`, decodes base64 for binary payloads or passes utf8 through for text, and writes to `basename(remote-path)` in cwd by default. `-o <local-path>` overrides the target; if it resolves to an existing directory the file lands inside as `basename(remote-path)` (cp-style). `--stdout` streams raw bytes (binary-safe). Refuses to clobber an existing local file unless `--overwrite` (the `--stdout` path bypasses the check). Files exceeding the 10 MB cap surface as `PAYLOAD_TOO_LARGE` from the route — the CLI exits non-zero with a hint that streaming for individual large files is not yet implemented.
- **`put`** — one `files.upload.mutate({ path, contentBase64, overwrite })`. Non-destructive by default; `--overwrite` opts into clobbering. Pre-flights the local file (must exist, must be a regular file) before any wire call. Refuses local directories — recursive upload is `dam import`'s job. The per-file size cap is enforced server-side and surfaces as `PAYLOAD_TOO_LARGE` from the route; the CLI doesn't duplicate the constant.
- **`list`** — one `files.tree.query()`. Default text output is one file path per line, directories omitted (pipe-friendly: `dam file list … | xargs -n1 dam file get …`). `--json` emits the full tree shape (files **and** directories with `type`). An optional `<remote-path>` argument prefix-filters the tree client-side.
- **Caps and exclusions** — the per-file size cap is enforced server-side in `agent-runtime`'s `FilesService` and surfaces on both `read` and `upload` as `PAYLOAD_TOO_LARGE` (single source of truth — the CLI doesn't duplicate the constant). Excluded basenames (`.git`, `.npm`, `.triggers`, `.claude.json`, `.initialized`, `node_modules`, `.DS_Store`) are invisible in `list` and refused on `put`. Symmetric to `dam import`'s exclusions.
- **No service layer** — each verb is one tRPC call; the action handler classifies inline rather than introducing a port, mirroring `dam import`.
- **Out of scope (v1)** — recursive directory download (combine `dam file list | xargs dam file get`), streaming for files > 10 MB, `dam file rm` / `mv` / `mkdir`, globs in `<remote-path>`. Each lands when a concrete use case appears.

## Network access

`dam network` manages per-Agent outbound-host rules — the pre-approvals that let an Agent reach external services without round-tripping the inbox ([ADR-035](../adrs/035-unified-hitl-ux.md)). The CLI is a thin wrapper around the `egressRules.*` tRPC procedures, at parity with the per-agent network access editor in the UI.

Seven commands, agent-scoped ones positional-first on the agent ref to match the existing verb convention:

- `dam network list <agent>` — six-column table sorted by `(host, method, pathPattern)`; `--json` emits `EgressRuleView[]`.
- `dam network preset <agent>` — current effective preset (`none` / `trusted` / `all`).
- `dam network create <agent> --host <h> [--method] [--path] [--verdict]` — adds a manual rule. `--method` and `--path` default to `*` (the L4 host-only rule); `--verdict` defaults to `allow`.
- `dam network update <rule-id> [--method] [--path] [--verdict]` — partial update; at least one flag is required. Flips `source` to `manual` server-side.
- `dam network revoke <rule-id>` — deletes the rule. Idempotent — unknown IDs exit 0.
- `dam network apply-preset <agent> --preset <name>` — bulk-seeds; replaces existing `preset:*` rows; preserves `manual` and `connection:*` rows.
- `dam network trusted-hosts` — the platform-wide hosts seeded by the `trusted` preset.

Two pieces of non-obvious behavior the CLI surfaces:

- **Path/method-specific rules require L7 enforcement.** When `create` or `update` produces a rule with non-wildcard method or path, the gateway has to re-MITM the host, which rolls the Agent pod (~5–15s). The CLI prompts on TTY; `--yes` bypasses; non-TTY without `--yes` exits `EXIT_INVALID_INPUT` (2). The check fires on user-passed flags only — false positives for already-L7 rules are accepted in preference to fetching the existing row.
- **Preset `all` is a development escape hatch.** `apply-preset --preset all` confirms before applying (mirrors the UI's `window.confirm`). Every preset apply prints an explanatory line to stderr that manual and connection-derived rules are preserved.

`update` against an unknown rule ID exits `EXIT_RULE_NOT_FOUND` (6) — the contract change in `egress-rules-service.ts` converts the plain `Error("egress rule not found")` to `TRPCError({ code: "NOT_FOUND" })` so the CLI can classify the error via `data.code`.

The `source` field is rendered via the shared `formatEgressRuleSource` helper in [packages/api-server-api/src/modules/egress-rules/format.ts](../../packages/api-server-api/src/modules/egress-rules/format.ts) so the CLI and UI use identical labels.

## Connections

`dam connection` brings the CLI to parity with the UI for managing **Connections** — the stored credentials and contributions an Agent uses to reach authenticated external APIs and MCP servers (the concept is owned by [connections.md](connections.md) / [ADR-051](../adrs/051-connections-and-contributions.md); credential injection is [ADR-033](../adrs/033-envoy-credential-gateway.md)). The CLI is a thin client over the `connections.*` tRPC procedures. Six commands:

- `dam connection list [<agent>]` — without an Agent, a five-column table (`ID NAME CATEGORY STATUS HOSTS`) of every team connection — apps and MCP servers alike — sorted by `(category, name, id)`; with an Agent, only that Agent's granted connections. `--json` emits the raw `ConnectionView[]`.
- `dam connection templates` — a read-only listing of the connection catalog a Connection can be created *from* (apps + custom-credential types), as a five-column table (`ID NAME CATEGORY AUTH DESCRIPTION`) sorted by `(category, name, id)`; `--json` emits the raw `ConnectionTemplateView[]`. It excludes MCP-category templates — every listed id is a valid `connect <id>` argument, and `connect` rejects raw mcp-category ids in favor of a URL — and footers the MCP-by-URL path to stderr. Distinct from `connection list`: that shows the connections you've *created*; this shows the ones you *can* create.
- `dam connection connect <provider-or-url>` — create a Connection. The positional is either a **provider template id** or an **MCP server URL** (anything that parses as an `http(s)` URL); template ids are slugs that never contain `://`, so the form is unambiguous.
  - **Template id.** Resolves the template by id (unknown id exits `EXIT_INVALID_INPUT`; a raw MCP-category template id is rejected with a "pass its URL" redirect), collects the inputs the template declares (typed flags such as `--client-id`/`--value`, with interactive `@clack` prompts filling any *required* gap on a TTY — secrets masked — and a non-TTY gap erroring out naming the missing flag).
  - **MCP server URL.** Discovers the server's auth requirement via `connections.discoverMcp` (overridable with `--auth oauth|none`; an invalid value exits `EXIT_INVALID_INPUT`), picks the `custom-mcp-oauth` or `custom-mcp-none` built-in template accordingly, and derives the connection name from the host (`mcp.notion.com` → `notion`; `--name` overrides, and a TTY offers the derived value as an editable default).
  - Both forms converge on `connections.create`, then the shared tail: for an OAuth template it `connections.startOAuth` → opens the system browser (`--no-browser` prints the URL instead; an open failure degrades to printing) → polls `connections.get` every 2s up to `--timeout` (default 300s, under the server's 10-min pending-flow TTL) until `status === "active"`. Header/none templates (including a no-auth MCP server) need no browser and report success immediately. A poll timeout exits non-zero with a "check `dam connection list`" hint and leaves the connection in place (it may complete late). `--json` emits `{ ok, id, status, authKind }` (plus `authUrl` under `--no-browser`).
- `dam connection grant <agent> --connection <id-or-name>…` — grant one or more connections to an Agent, each addressed by id or unique name. Additive.
- `dam connection revoke <agent> --connection <id-or-name>…` — revoke one or more connections from an Agent, each addressed by id or unique name. Idempotent.
- `dam connection disconnect <id-or-name>` — delete a team connection (by id or unique name) and its stored credential.

Everything is tRPC (`connections.list`, `listTemplates`, `create`, `startOAuth`, `discoverMcp`, `get`, `getAgentConnections`, `setAgentConnections`, `delete`) — there is no REST surface and no service state beyond the per-host client. Four pieces of non-obvious behavior:

- **Refs are id-or-name; resolution happens client-side.** `grant`/`revoke`/`disconnect` accept either a `conn-…` id or a connection's name. Names are unique per owner (DB-enforced), so a name resolves to at most one connection — no ambiguity, unlike Agent refs. The shared `resolveConnectionRef` helper does the lookup against `connections.list`: a `conn-…` prefix matches by id, anything else by name.
- **Grant/revoke are read-merge-set; disconnect resolves before deleting.** `connections.setAgentConnections` is a full replace, so the CLI reads the Agent's current grants (`getAgentConnections`), unions in (grant) or subtracts out (revoke) the resolved ids, and writes the whole set back — letting the server re-fan-out each connection's contributions (env vars + egress injection) for the correct final set. `grant` resolves every ref against the team list and rejects any that don't (`EXIT_INVALID_INPUT`) so a dead grant is never stored. `revoke` resolves names too, but lets a raw `conn-…` id pass through even when it's no longer in the team list — that's how a stale grant (a since-deleted connection) is cleaned up; only an unknown *name* errors. `disconnect` resolves its ref against the team list and exits `EXIT_INVALID_INPUT` when nothing matches: the server's `delete` is idempotent (an unknown id still succeeds), so resolving first is what prevents a typo'd id or a bare name from reporting a false "Disconnected".
- **Stale grants are surfaced, not hidden.** `list <agent>` intersects the Agent's granted ids with the team list; any granted id that no longer resolves to a live connection is reported on stderr rather than rendered as a fabricated row.
- **`connect` polls a server-side completion marker, not token expiry.** The browser OAuth flow is server-mediated (the api-server is the OAuth client; the provider redirects to the server's fixed callback, which redirects on to the *web UI's connections page* (`/connections`) — there is no terminal callback), so the CLI can only observe completion *through the server* by polling `connections.get(id).status`. That status now derives from a `connectedAt` marker the server stamps on every successful token exchange — independent of whether the provider returns a token expiry — so a connection with a non-expiring token (e.g. classic GitHub OAuth) reaches `active` rather than sticking at `pending`. (Before this marker existed, expiry was the only signal, so such connections never read as `active` — in the CLI poll or the UI list.)

MCP servers connect via their URL (`dam connection connect https://…`), which discovers auth and selects the right built-in MCP template. `dam connection templates` lists the *connectable* catalog but deliberately excludes mcp-category templates (`connect` rejects their raw ids), so the URL-first form remains how MCP servers are added — the templates listing footers exactly that. Listing, granting, revoking, and disconnecting are category-agnostic and unchanged — an MCP connection shows up in `list` with `CATEGORY=mcp` and is removed by `disconnect <id>` like any other.
