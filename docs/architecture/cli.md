# CLI

Last verified: 2026-07-17

## Overview

The `dam` CLI is a TypeScript Node package, distributed via npm, that users install on their own machine and point at a configured Platform deployment. It never runs inside the cluster. It reaches the api-server as a thin client: it shares the api-server's contract package directly, so server-side type changes reach the CLI without codegen or manual mirroring, and it calls the tRPC surface over plain HTTP for everything except the interactive `dam chat` session, which opens a WebSocket to the terminal relay. Command groups are singular (`agent`, `connection`, `channel`, …) to match `gh`, `git`, and `docker`.

The CLI is at parity with the web UI: every action a user can take in the browser has a verb. It owns no domain logic of its own — each command group is a thin surface over the api-server procedures the corresponding subsystem already exposes, so the concepts live on their owning architecture pages (see [Command surface](#command-surface)).

## Trust boundary

The CLI runs on the user's machine. It reads and writes only under the XDG config and state directories and makes outbound network calls only to the configured server. There is no telemetry and no anonymous reporting — the platform collects nothing, and the CLI does not break that posture.

The one deliberate exception is `dam ssh`'s editor modes: dam's own SSH host entries live in `$XDG_CONFIG_HOME/dam/ssh_config`, and a single `Include` line is added to `~/.ssh/config` so an external editor's SSH client can resolve the agent host. dam never touches the user's own `~/.ssh` keys (see [SSH access](#ssh-access)).

## Config

Two persistence concerns split across the XDG directories: editable configuration and credentials.

- **Configuration** lives at `$XDG_CONFIG_HOME/dam/config.toml` — a flat schema, no profile indirection. Its v0 key is the active server URL. New keys are registered at compile time; an undeclared key is a build error.
- **Credentials** live separately under `$XDG_STATE_HOME/dam/`, written by `dam auth login` (see [Authentication](#authentication)).
- **Resolution precedence** at invocation time is flag > env var (`DAM_SERVER`, and `DAM_<KEY>` for future keys) > file > error. There is no silent default.
- **Writes are read-merge-rename**: the CLI never discards unrelated top-level keys, so a user can hand-edit comments or future knobs without losing them.

## Compatibility negotiation

Before any networked verb runs, the CLI hits the api-server's unauthenticated version endpoint (plain HTTP, outside the tRPC surface) to learn the server's version and the minimum CLI version it accepts. Three verdicts:

- **Ok** — the local CLI is at or ahead of the server; the command proceeds.
- **BehindCurrent** — below the server but at or above the floor; the CLI warns to stderr and proceeds.
- **BelowFloor** — below the server's advertised minimum; gated verbs hard-fail, informational verbs proceed.

When the server advertises no floor, BelowFloor is never produced. The floor is operator-configurable via Helm, so known-broken clients can be dropped without rebuilding the image. Networked verbs opt into the gate; `dam version` is the un-gated informational counterpart that surfaces the same verdict but always exits 0.

## Authentication

`dam auth login` authenticates against the active host's Keycloak realm ([security-and-credentials.md](security-and-credentials.md)) via the OAuth 2.0 Device Authorization Grant ([RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628)). The realm advertises a public `platform-cli` client (device grant only, no secret); the CLI discovers its id from the server rather than hardcoding it, then drives the standard device flow — print (and optionally open) a verification URL, poll the token endpoint — and on success persists a per-host credential record under `$XDG_STATE_HOME/dam/` with restrictive permissions and an atomic write.

Credentials are keyed by host URL, so switching between deployments never clobbers state. `dam auth status` lists each host, credential source, and token expiry, and never prints tokens. `dam auth logout` best-effort revokes the refresh token ([RFC 7009](https://datatracker.ietf.org/doc/html/rfc7009)) and removes the local entry; the local clear always proceeds even when revocation fails. Logout is deliberately not RP-Initiated Logout — the CLI must not kill SSO sessions belonging to the web UI or federated apps.

The `auth` module exposes one seam — **`TokenProvider`** — that every authenticated verb consumes. Its precedence: the `DAM_TOKEN` env var (used verbatim, never refreshed) > the stored per-host credential (refreshed proactively near expiry, with rotated refresh tokens persisted) > a not-logged-in error. A refresh that fails with an invalid grant clears the entry and surfaces a session-expired signal directing the user back to `dam auth login`.

Those are the client-side signals. The server can also reject a request that looked valid locally, and the CLI surfaces that distinctly rather than as a transport failure: it maps the api-server's raw 401/403 (alongside the existing 412 Terms gate) to typed errors. A 401 becomes session-expired — with a hint that switches to "check `DAM_TOKEN`" when that variable is set, because a bearer supplied that way lives outside the credential store and re-login can't fix it. A 403 becomes access-denied with no login hint: the caller is authenticated but not authorized (e.g. a pending-approval account), so the remedy is an admin, not re-authentication. Any other reached-but-rejected request surfaces the server's own reason; "cannot reach server" is reserved for genuine connectivity failures.

For headless / CI use, `DAM_TOKEN=<bearer>` is used verbatim and bypasses the credential store. It accepts either a Keycloak access token or a Platform **API key** (`pk_…` prefix); the CLI does not branch — the server's bearer middleware dispatches by prefix. There is no `--token` flag, to keep tokens out of shell history and `ps`.

**API keys** (`dam auth token`) mint, list, and revoke long-lived keys scoped to a set of capabilities and optionally bound to specific agents. A created key's plaintext is returned once and printed to stderr (so a `>` redirect doesn't silently capture it) unless `--json` requests it on stdout. API-key principals cannot mint further keys — the server enforces that, so the constraint holds regardless of how the CLI is driven. Concurrent writes to the credential store are not coordinated in v1 (a solo, single-terminal assumption): overlapping processes can each persist their own merged snapshot, at worst forcing one re-login.

## Agent addressing

The `agent` module gives users a human-friendly way to name an Agent and exports the seam every Agent-targeted verb consumes.

- **Agent Ref** — what the user types: either an Agent ID (anything beginning with the reserved `agent-` prefix) or an Agent name. The split is syntactic; no probe disambiguates them.
- **Resolver policy** — an `agent-…` ref is fetched by id; anything else is matched by exact, case-sensitive name. Zero matches is not-found, one is ok, two or more is ambiguous. No normalization, no retries, one round-trip.
- **Reserved ID prefix** — the controller mints Agent IDs with the `agent-` prefix, and the api-server rejects Agent names that begin with it at create time, eliminating the only ambiguous case.
- **Uniqueness** — `(owner, name)` is unique, enforced at create time; the narrow race window is accepted for CLI traffic and falls through to the resolver's ambiguous path.
- **`AgentResolver`** is exported from the module and imported by every downstream verb, which then binds an agent-scoped client to the resolved active host.

## Command surface

The CLI is at parity with the web UI across these groups. Each concept's depth lives on its owning architecture page; per-verb flags, exit-code numbers, and tRPC procedure names live in the code, not here.

- **`auth`** — login, logout, status, and API-key management ([Authentication](#authentication)).
- **`agent`** — list, get, create, interactive create, delete, restart, plus read-only template listing ([Agent lifecycle](#agent-lifecycle)).
- **`chat`** / **`session`** — attach a local terminal to a running agent's TUI, and list an agent's sessions ([Terminal attach](#terminal-attach)).
- **`ssh`** — a login shell, SCP/SFTP, port-forwarding, and editor Remote-SSH into an agent ([SSH access](#ssh-access)).
- **`import`** / **`file`** — bulk upload and granular file get/put/list into an agent workspace ([Files and import](#files-and-import)).
- **`network`** — per-agent egress pre-approval rules; **`approval`** — the HITL inbox of prompts that did appear. Both owned by [security-and-credentials.md](security-and-credentials.md).
- **`connection`** — stored credentials and MCP contributions an agent uses, owned by [connections.md](connections.md).
- **`channel`** — Slack channel bindings and the per-agent allow-list, owned by [channels.md](channels.md). Slack connect takes the binding's access mode (`--mode`, person-scoped by default; fixed per binding, so changing it is disconnect + reconnect), and the channel listing shows each binding's mode — Telegram rows always shared, since the mode is structural there. A shared connect against a server that doesn't understand modes is verified and rolled back rather than silently landing person-scoped. Telegram binds in-chat (`/login`), so it has no CLI verb.
- **`skill`** — git-based skill sources, install/uninstall, and publish, owned by [skills.md](skills.md).
- **`schedule`** — time-triggered task recurrences on an agent, owned by [agent-lifecycle.md](agent-lifecycle.md).

## Shared conventions

Every command group is a thin client over the procedures its subsystem already exposes, holding no service state beyond a per-host client. The recurring patterns, stated once:

- **Thin surface, server-authoritative.** The CLI does not re-validate domain rules it doesn't own; it sends the request and classifies the server's typed error, surfacing the server's reason for bad input, conflicts, and authorization failures. A few service boundaries convert plain errors to typed tRPC codes specifically so the CLI can classify them.
- **Exit-code registry.** Beyond generic success/failure, the CLI has a small set of named exit codes for machine callers (agent-not-resolved, invalid-input, rule- and schedule-not-found, agent-not-reachable, approval-not-actionable). Wrapper scripts branch on the code; the specific numbers are a code-level contract, not architecture.
- **`--json` parity.** Every read verb emits raw contract types under `--json` (an empty result is `[]`, never null); mutations emit a small result object. A very small number of verbs augment the raw shape where the annotation is the whole point of the flag — those departures are documented at the call site.
- **TTY discipline.** Destructive verbs confirm on a TTY, take `--yes` to bypass, and refuse on non-TTY without it. Interactive-only verbs (interactive create, masked secret prompts) refuse on non-TTY and point at the scripted path.
- **Client-side ref resolution.** Agent refs resolve through `AgentResolver`; connection and skill-source refs resolve id-or-value against a team list before mutating, so a typo can't ride through a server-side no-op and report a false success.
- **Full-replace mutations are read-merge-write.** Where a server mutation replaces an entire set (agent grants, allow-lists, egress presets, a schedule's whole spec), the CLI reads the current value, overlays the change, and writes the whole set back, so the server re-derives the downstream effects for the correct final state.
- **Shared formatting and builders.** Where the CLI and UI must render or compute identically — egress-rule and approval-payload labels, the recurrence builder and its human-readable text — the logic is a React-free helper in the contract package that both consume, so the two can never drift.

## Agent lifecycle

The CLI presents Agents as single, atomic entities — one resource carrying both spec and runtime state, with no separate instance type.

- **Create** is one mutation; env vars and description attach to the payload and the merged Agent is provisioned atomically server-side. **Delete** cascades through Kubernetes ownership to the StatefulSet, Service, NetworkPolicy, and owned volumes — the same path the UI's delete uses. **Restart** deletes the agent's pod; the controller recreates it with the current spec and persistent volumes survive.
- **`--wait`** on create and restart polls until the agent settles on running (success) or error (terminal), with a bounded timeout after which the agent is left as-is and the command exits non-zero. Under `--json` every exit path still emits a valid Agent payload, so scripted callers never see empty stdout.
- **`dam agent create-interactive`** is the TTY-bound complement to scripted create: it walks name → template → model-provider connection → optional GitHub PAT and ends with the same agent and grants the UI's "Add agent" dialog produces, running the same server mutations in the same order. Anything it creates during the run is tracked in a ledger and torn down in one cleanup pass on failure; what cleanup can't remove is reported as an orphan summary. The scripted `create` path stays the entry point for CI.

## Terminal attach

`dam chat <agent>` connects the local terminal to a running agent's interactive TUI over a WebSocket, using the same binary terminal-frame protocol as the UI's terminal mode. It requires a TTY and puts stdin in raw mode so keystrokes — including Ctrl+C — pass through to the remote harness rather than being intercepted locally.

Session strategy is resolved **client-side**: sessions are agent-owned, so the CLI lists them over its own ACP connection to the api-server relay and resolves locally — mint a fresh id (new, the default), match the single most-recent terminal session (continue), or target a specific id (resume, prompting before a chat→terminal mode switch) — then builds the terminal-relay URL itself. There is no server-side session endpoint. A `--reset` flag tells the relay to kill the PTY and spawn a fresh one, which also clears the agent-side session. On disconnect the CLI prints a ready-to-paste resume command. `dam session list` reads the same agent-owned session list.

## SSH access

`dam ssh connect <agent>` drops into a plain login shell in the agent's workspace and supports everything real SSH does — `scp`, `sftp`, port-forwarding, and editor Remote-SSH. Where `dam chat` attaches to the harness TUI, SSH gives a bare shell. The session inherits the agent pod's environment — the egress proxy, credential sentinels, and `PATH` — so `git`, `gh`, and the AI CLIs work exactly as they do for the harness (the agent-runtime replays the live injected env per connection; without it even DNS fails, since egress is proxy-only).

The transport is an in-pod OpenSSH `sshd` spawned per connection and tunneled over the agent WebSocket; the SSH wire protocol is opaque to the CLI and api-server, which relay bytes verbatim. SSH terminates at the in-pod sshd, which reuses the same upgrade auth (token → ownership → terms) as `dam chat`. Authentication to sshd is public-key via a dedicated dam keypair under `$XDG_STATE_HOME/dam/` — the user's real identity is the bearer token verified at the WebSocket upgrade, and the SSH key is only the transport credential. Host-key checking is disabled deliberately: the TLS-encrypted upgrade is the real trust boundary, so the in-pod host key authenticates nothing extra and only broke connections when a volume rotated it.

A single `--exec` flag selects the client and how it is invoked (`ssh`, or an editor in `code`/`zed` mode). Editor modes write a managed host block to dam's own ssh_config and pull it into `~/.ssh/config` via one `Include` line — the reliable cross-client hook, since editors are often already-running singletons that ignore a launch-time environment — then launch the editor against the agent alias; `dam ssh configure` writes those blocks without launching and can reconcile them to the host's current agents or clear them. `code` mode additionally pre-allows the VS Code server-download hosts as egress rules so the connect doesn't trip a mid-flight approval prompt. `dam ssh` depends on the OpenSSH client locally; `sshd` ships in the shared agent base image, so every agent supports it.

## Files and import

`dam import <agent> <path…>` bulk-uploads files or folders, each path argument becoming one atomically-replaced top-level entry under the agent's workspace. It builds a single gzipped tar — skipping symlinks and a shared exclusion set (`node_modules`, `.venv`, …) — and POSTs it as multipart to the same import endpoint the UI targets. Top-level replace is destructive at each named path, so it confirms on a TTY.

`dam file get/put/list` are the granular, non-destructive counterparts — each operates on a single file over the same per-agent file surface the UI's file browser uses, reusing the shared token, compatibility, and resolver seams. Per-file size caps and the exclusion set are enforced server-side (single source of truth); the CLI surfaces the server's too-large error rather than duplicating the constant. Neither verb group introduces a service layer — each is one wire call classified inline. Recursive download, large-file streaming, and rm/mv/mkdir are out of scope until a concrete use case appears.
