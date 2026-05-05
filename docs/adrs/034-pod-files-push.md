# DRAFT-ADR: Push declarative file state to agent pods

**Date:** 2026-04-27
**Status:** Draft
**Owner:** @jjeliga

## Context

ADR-024 established that the entity owning a credential declares which **env vars** the agent pod needs, and the platform materializes them at reconcile time. The parallel question — which **files** the agent pod needs, and how to keep them current without rolling the pod — was unanswered.

Issue #307 surfaced the first concrete instance: `gh auth status` for GitHub Enterprise needs `~/.config/gh/hosts.yml` populated based on which github-enterprise app connections the agent has been granted, and the file must update when grants change without restarting the pod.

But the pattern is broader. Other state in platform that could plausibly need to land as files in agent pods:

- **Per-agent UI-edited config** (system prompts, MCP server lists, channel allowlists) — currently lives in env or ConfigMaps that roll the pod on change
- **Schedule metadata** that some scheduled actions need to read at runtime
- **Channel metadata** (Slack workspace info, Telegram bot config) for tools that want it on disk
- **CLI configs that other tools require alongside their proxied auth** — e.g. `~/.gitconfig` for `user.name`/`user.email`, future gcloud / kubeconfig files that name a host or context (no credentials, just naming) — analogous to gh's hosts.yml, which lists the host but uses a sentinel for the token
- **Tool defaults / allowlists / non-sensitive policy** that a platform-managed CLI tool wants to read

**Compatibility with ADR-005 (agent never sees raw credentials).** This mechanism never writes a real secret to disk. Files can carry the same `platform:sentinel` token that env vars use, with the gateway swapping it on outbound requests for the relevant host (the gh hosts.yml case proves the pattern). Producers that would need to write a real credential to disk are out of scope — they violate the gateway model and should stay rejected.

The same three constraints apply to all of them:

- **Decouple from the agent harness** — user-replaceable agent harnesses (the `AGENT_COMMAND` layer per ADR-023) must keep working without platform-specific code baked in.
- **No pod restart on state change** — rolling the pod kills live conversations and in-flight tool runs.
- **Sub-second propagation** — "click thing in UI, then run command" must just work.

The third forces real-time push (polling is too slow); the first two force the work to live in a platform-owned process inside the pod, alongside the agent harness — i.e. in `agent-runtime`, which already hosts platform machinery (ACP server, file-service tRPC, trigger watcher) without touching the harness.

## Decision

Introduce a generic **pod-files push** mechanism — the filesystem-state analogue of ADR-024's connector-declared envs:

1. **Producers, not just connector entries.** Each managed file is owned by a `FileProducer` — an opaque function `(owner) → FileSpec[]` that fetches its own state from whatever source it cares about (OneCLI connections, platform secrets, schedules, …) and emits the file fragments it wants materialized. The platform never sees the source data; it only composes producer outputs by destination path.

2. **agent-runtime materializes pod-files.** The existing platform-owned `agent-runtime` process (already running ACP, the file-service tRPC, and the trigger watcher per ADR-023) holds an SSE connection to the api-server, receives `FileSpec`s, and merges them into the declared paths via the requested mode. No sidecar; no shared `emptyDir`. The runtime writes directly under `HOME` on the pod's PVC, so anything the agent harness's image baked at the same path participates in the merge instead of being shadowed by a mount.

3. **Push channel.** A single SSE endpoint `GET /api/instances/<id>/pod-files/events` per instance. Snapshot on connect, upsert on state change. Per-instance Bearer auth, identical to the existing MCP endpoint. In-process pub/sub on the api-server keys topics by **agent name** (so all instances of the same agent share a topic, since most current sources of state are agent- or owner-scoped).

4. **Publisher seam, source-tagged.** `PodFilesPublisher.publishForOwner(owner, agentName, source)` is the single entrypoint state-mutating services call after they touch state. Each producer declares the `source` it reads (e.g. `"app-connections"`); the publisher only runs producers whose source matches. Producers stay opaque about *what* state they read — only the source tag is used for routing. The SSE-connect snapshot path (`compute(owner)`) still runs all producers, since at that moment we don't know what changed since the runtime last connected.

5. **Merge modes.** Currently one: `yaml-fill-if-missing`. Adds new top-level keys; for keys that already exist, fills only fields that are absent. Never overwrites a present field; never deletes. Preserves manual edits and unrelated content (values; comments are not preserved across re-serialization — accepted limitation of `js-yaml`). Other modes (`json-merge`, `text-append`, `template-overwrite`) can slot in as needed.

6. **Owner impersonation when needed.** Producers running outside a live user JWT (snapshot path on SSE connect) can use Keycloak service-account + RFC 8693 with `requested_subject`. The api-server's `OnecliClient` exposes this as `impersonate(sub)` and `onecliFetchAs(sub, path)`; producers that need user-scoped reads from external systems use the same pattern.

7. **Forks are env-gated.** Fork pods are short-lived per-turn Jobs and don't need pod-files state. The reconciler simply doesn't set `PLATFORM_POD_FILES_EVENTS_URL` on fork pods, so the runtime there skips the loop. Explicit, env-driven, hard to miss.

The `github-enterprise → hosts.yml` case is the first registry entry; it's a small producer factory that closes over a `fetchConnectionsForOwner` function. Adding a different state source is one new producer factory in `producers/`, registered in `buildPodFilesRegistry`. No platform changes.

## Alternatives considered

- **Init container only.** Bootstrap once at pod start; mid-session changes stale until a manual restart. Rejected: sub-second goal explicitly forbids it.
- **Polling sidecar.** Simplest possible push-adjacent design; ~30 s lag. Rejected for the same reason.
- **Separate sidecar (platform-config-sync).** What we shipped first — a Go sidecar reusing the controller binary, holding its own SSE connection and writing into a shared `emptyDir` mounted at `~/.config/gh`. Rejected after one iteration for two structural reasons:
  - **emptyDir shadows image-baked content.** The mount hides anything the agent image baked under the same parent path; `yaml-fill-if-missing` only ever sees the empty volume. Image-authored configs can never participate in the merge — a real cost for users who pre-configure tools at build time.
  - **Mount choreography per producer parent dir.** Each new managed parent dir would need an explicit `emptyDir` + mount in the controller's pod-template builder. Future producers (gitconfig, gcloud naming, kubeconfig naming, allowlists, …) would each pay this tax indefinitely.
  - The benefits of a separate sidecar (Go binary reuse, sidecar-vs-runtime failure-domain split) are real but bounded: the runtime already concentrates several long-lived loops (ACP, trigger watcher) and isolates per-iteration errors with `try/catch`; the same pattern protects the pod-files loop. Release-lane separation is theoretical in this monorepo (controller and agent-runtime ship together).
- **ConfigMap + subPath mount with auto-refresh.** Kubelet auto-projects non-`subPath` ConfigMap changes within ~1 minute. Rejected: latency too high, and ConfigMap-projected files are read-only (the design wants room for the agent to edit in place).
- **Connector-only abstraction.** What we shipped second — `ConnectorFile { provider, path, render(connection) }`. Rejected after one iteration: it bakes "OneCLI connections" into the type signature, foreclosing non-connection sources without a refactor. The producer abstraction is barely larger and source-agnostic.
- **Push the work into OneCLI (extend `envMappings` with files).** Single source of truth for connector contracts, but the project decided in #307's discussion that consumer-specific knowledge (gh CLI's hosts.yml shape) lives in platform, not OneCLI. Producer-specific code lives next to the consuming side.

## Consequences

- **Adding a managed file is one producer factory** plus an entry in `buildPodFilesRegistry`. The platform stays unchanged across new producers.
- **The pod spec stays static** across state changes. The agent container always sets `PLATFORM_POD_FILES_EVENTS_URL` (instance pods only); adding or removing connections never alters the spec.
- **The agent harness stays untouched.** Users can bring any harness; agent-runtime — platform-owned, in `platform-base` — does the materialization beside it.
- **Image-baked content participates in merge.** Anything the agent image lays down under HOME stays on disk; fill-if-missing reads it, merges platform's entries on top, writes back. No shadowing.
- **No mount choreography per producer parent dir.** New producers can write any path under `HOME` without changing pod-template logic.
- **HOME is a single chart value.** `agentHome` (default `/home/agent`) is set once in the helm chart and read by both the controller (for the `HOME` env var on the agent pod) and agent-runtime (for path validation in the loop). Producer paths are HOME-relative, never literal.
- **Cross-replica fanout is the only deferred scaling concern.** Multi-pod *agents* work today: the bus is keyed by agent name, so all pods of the same agent subscribed to the same api-server replica receive every publish. Multi-pod *api-server* is the open case.
- **agent-runtime refuses paths outside agent HOME.** Defense-in-depth: a buggy or compromised api-server payload pointing at `/etc/...` or using `..` traversal is rejected before any write. The runtime reads its allowed prefix from the chart-level `agentHome` (via `HOME_DIR`).
- **Fork jobs deliberately do not run the loop.** Fork pods don't get `PLATFORM_POD_FILES_EVENTS_URL` set; the runtime skips the loop. Forks are short-lived per-turn Jobs; the relay flow doesn't read pod-files state.
- **Stale entries linger after revoke / source removal.** Producers can only add to files, not remove. Revoked hosts still appear in `gh auth status` until manually edited; gateway no longer swaps the sentinel, so calls fail loud. Accepted for safety against accidental data loss.
- **Failure-domain concentration.** A bug in pod-files code shares the runtime process with ACP and the trigger watcher. The loop is wrapped in `try/catch` per the same pattern the trigger watcher uses, so per-iteration errors don't escape; only a thrown error during sync startup would impact other runtime concerns. Acceptable given the runtime already concentrates platform machinery in one process.

## Future extensions (decisions, not open questions)

- **More producer sources.** New tags slot into `ProducerSource` in `pod-files/types.ts` (currently `"app-connections"` only). Each new state-mutating service calls `publishForOwner(.., "<its-source>")`; each producer reading that state declares matching `source`. Naming convention: name the *state source* (the system), not the action.
- **Multi-replica api-server fanout.** The `PodFilesBus` interface (`subscribe`/`publish`) is the swap-in seam — any cross-replica adapter slots in with no caller changes. Two viable options depending on circumstances at the time of need: `pg_notify` on channel `pod_files:<agentName>` (zero new infra; Postgres is already in the stack; sufficient for pod-files' event volume), or Redis pub/sub (purpose-built for fanout, no payload cap, naturally pattern-subscribable; worth it if Redis is also being introduced for other cross-replica state — e.g. pending OAuth flows, token caches). Decision deferred until horizontal scaling becomes a real requirement and the broader cross-replica picture is clearer.
- **Comment-preserving merge.** If a future producer needs to write into user-edited files where comments matter, replace `js-yaml` with the `yaml` package (Eemeli Aro's, Document API), which preserves comments via its CST. Today's gh hosts.yml case doesn't need this.
