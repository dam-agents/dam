# ADR-027: Slack per-turn user impersonation — foreign repliers fork the instance into a K8s Job

**Date:** 2026-04-22
**Status:** Accepted
**Owner:** @tomkis
**Amends:** ADR-018
**Builds on:** ADR-015, ADR-005

## Context

Today, a Slack thread is routed to a single Platform instance by the `threadTs → instance_id` mapping (ADR-018). Every reply in that thread is relayed to the same instance, and the agent pod makes outbound calls (GitHub, Anthropic, etc.) through OneCLI using the **instance owner's** identity — the OneCLI access token baked into the pod by the controller is scoped to whoever created the instance (ADR-015).

This conflates two distinct concepts:

1. **Which instance handles the turn** — naturally scoped to the thread: same workspace, same agent config, same conversation.
2. **Whose credentials back the outbound calls during the turn** — should follow the **replier**: if Alice started the thread but Bob replies asking the agent to open a PR, the PR should be opened as Bob, not Alice.

### Why the obvious fix doesn't work

The initial draft of this ADR proposed passing a per-turn api-key through ACP `_meta` and having the agent-runtime swap the pod's OneCLI credentials for the turn. This is not implementable, because the OneCLI token is not a request-time parameter — it is **structural** to the pod:

- The controller stores the token in a per-agent K8s Secret `platform-agent-{agentName}-token` and injects it as `ONECLI_ACCESS_TOKEN` (see `resources.go:28-38`).
- Both `HTTPS_PROXY` and `HTTP_PROXY` are set to `http://x:$(ONECLI_ACCESS_TOKEN)@gateway:port` and resolved by Kubernetes at pod startup (`resources.go:26,39-42`).
- All outbound traffic from the agent process, its child processes (git, curl, npm), and every tool it spawns goes through this proxy. The credential routing lives in the container's environment, not in the agent-runtime.
- There is no hook to change the proxy auth between turns: env vars are frozen at container start, and child processes inherit the frozen copy.

Per-turn impersonation therefore cannot be done by mutating state inside the running pod. It has to be done by running the turn in a **different execution environment** that has the replier's credentials baked in from its own startup.

## Decision

### 1. Outbound identity follows the replier, via forked execution

For each Slack message relayed to an instance:

- If the replier **is the instance owner**, the turn runs in the main StatefulSet pod, exactly as today. No change.
- If the replier **is a foreign user** (linked via `/platform login` but not the owner), the turn runs in a **per-turn Kubernetes Job** whose pod has the replier's OneCLI token baked into its `HTTPS_PROXY` from startup.

Thread routing (`threadTs → instance_id`) is unchanged — the instance is still bound to the thread. What changes is *where* a given turn executes: owner turns go to the main pod; foreign turns go to a short-lived Job.

### 2. Forked Jobs mount the instance's PVC via RWX

The forked Job pod mounts the same `/home/agent` PersistentVolumeClaim as the main pod. This requires switching the PVC's access mode from `ReadWriteOnce` to `ReadWriteMany` so that the main pod and the Job pod can mount it simultaneously.

Consequences:

- **Storage class must support RWX.** For the k3s-on-lima development cluster, the default `local-path` provisioner does not support RWX; we will ship `nfs-server-provisioner` as part of the Platform chart's dev-cluster install flow. It runs an in-cluster NFS server as a StatefulSet backed by `local-path`, and exposes RWX PVCs on top of that export — self-contained, one Helm install, no host-level NFS setup. Production deployments on managed K8s use the cloud-native RWX options (EFS, Filestore, Azure Files).
- **Session continuity is automatic.** Claude Code's session transcript lives at `/home/agent/.claude/projects/…/*.jsonl`, which is on the shared PVC. A Job can resume the session by calling `unstable_resumeSession({ sessionId })` — the agent-runtime invokes Claude Code with `--resume`, which reads the same on-disk JSONL that the main pod last wrote. New messages append to the same file, so the next main-pod turn picks up Bob's contribution transparently.
- **Working tree is shared.** Git history, dependency caches, `.claude` state, MEMORY.md — all of it is the same bytes across the main pod and the Job. This matches the "we're working on this together" model of shared Slack threads.

### 3. Job spec — short-lived, one turn, auto-cleanup

For each foreign-user turn the controller creates a Kubernetes Job:

- **Image, command, init containers**: identical to the instance's StatefulSet pod, so agent-runtime boots the same way and serves ACP on `:8080`.
- **Volume mounts**: the instance's RWX PVC at `/home/agent`; the CA-cert emptyDir populated by the existing fetch-ca-cert init container.
- **Env**: the replier's `ONECLI_ACCESS_TOKEN` is read from the fork ConfigMap's `spec.yaml.accessToken` (minted by the api-server — see §4) plus the instance's connector env vars collected by the controller via `factory.ClientForOwner(foreignSub)` + `ListSecretsForAgent`. RFC 8693 impersonation therefore runs in both processes: api-server for the OneCLI access token, controller for per-agent secret listing. Splitting it keeps the existing secret-listing path in the controller (adjacent to the main-pod code it mirrors) and keeps the api-server free of agent-secret enumeration.
- **Lifecycle**: `restartPolicy: Never`, `backoffLimit: 0`, `ttlSecondsAfterFinished: 60` so the Job and its pod are garbage-collected shortly after the turn ends. The agent-runtime exits when the ACP connection closes. The controller enforces a 120 s pod-readiness deadline measured from ConfigMap creation: if the pod isn't Ready within that window, it writes `status.yaml.phase = Failed{Timeout}`. Job-failure maps to `Failed{PodNotReady}`; spec errors map to `Failed{OrchestrationFailed}`. The relay posts an ephemeral error to Slack; retrying mid-conversation would risk double-executing side effects (PRs, comments) under two different pod instances.
- **Addressability**: the controller writes the pod IP to `status.yaml.podIP` once the pod is Ready; the api-server reads it from there. No Service is needed — the connection is single-consumer, single-producer, for the lifetime of the turn.

### 4. Credential provisioning for foreign users — minted by the api-server, inlined into the Job via the fork ConfigMap

The main pod gets its OneCLI access token from a long-lived per-agent Secret because its pod is long-lived. Forked Jobs are ephemeral (`ttlSecondsAfterFinished: 60`), so the token does not need K8s-level persistence.

Registration is **lazy** — on first turn from a given `(instanceId, foreignSub)` pair, not at `/platform login` time. Eager registration would have to fan out across every platform-agent for every linked user (Slack logins are not instance-scoped), which scales as `users × agents` and produces dead registrations for users who never reply in a given thread. The lazy cost — one RFC 8693 exchange plus one `CreateAgent` round-trip — is paid once per `(user, instance)` across the user's lifetime and amortizes to zero.

Minting runs **in the api-server**, not the controller. The api-server is where identity-bearing requests land (Slack relay already resolves `keycloakSub`), where a cache can survive across reconcile loops, and where the RFC 8693 token-exchange code can live alongside other outbound-identity concerns in the `connections` module. Putting the mint step in the controller would force an identity round-trip across processes just to build a Job; instead, the minted token rides in `spec.yaml` and the controller only needs to read it and plug it into the Job env.

On fork request:

- The api-server's `ForeignRegistrationService` performs the RFC 8693 exchange against Keycloak (service-account → impersonation) to obtain a OneCLI client scoped to the foreign user.
- Registers an agent under that user in OneCLI. The identifier is `fork-{instanceId}-{sha256(foreignSub)[0:12]}` — per-instance, not per-agent: two instances of the same platform-agent produce two OneCLI fork-agents for the same foreign user. We picked this because the identifier lives longer than the fork (OneCLI agents are persistent) and because per-instance isolation makes later audits — "which PRs did Bob open via which instance?" — straightforward.
- `POST /api/agents` is idempotent over the identifier: OneCLI returns `409 Conflict` on duplicate; the port falls back to `GET /api/agents` and picks the matching entry. First turn from a user on an instance registers; subsequent turns return the same token.
- Immediately after Create (and on the 409 fallback), the port calls `PATCH /api/agents/{id}/secret-mode` with `{mode: "all"}`. OneCLI's default for newly created agents is the empty-secret mode, which would leave the fork pod's proxy token carrying no Anthropic/GitHub/etc. credentials — every outbound call would 401. `secret-mode=all` makes any secret the foreign user has configured in their OneCLI account visible to the fork for the duration of the turn, matching the user expectation "I set up my Anthropic key → my fork just uses it".
- The resulting OneCLI access token is written to the fork ConfigMap's `spec.yaml.accessToken`. The controller reads it and inlines it directly into the Job's `env[]` as `ONECLI_ACCESS_TOKEN`. The pod's `HTTPS_PROXY` interpolation (`http://x:$(ONECLI_ACCESS_TOKEN)@gateway:port`) works identically.

Caching in the api-server:

- Cache: `(instanceId, foreignSub) → accessToken`, in-memory. Keyed on the same tuple as the OneCLI identifier so a cache hit directly returns the token stored under that OneCLI agent.
- Semantics: no TTL (OneCLI access tokens have no server-side expiry; they are API-key-like strings), no size bound (cardinality is `|instances| × |foreign users who touched them|` — bounded by team size × instance count, not turn rate). Cache miss on api-server restart is fine: the next turn re-mints via the 409 path and re-caches.
- Evict on `allowedUsers` removal — `evict()` method exists on the service, but the wiring from the instance-reconciliation path that detects a removed sub is not yet in place. Acceptable: a stale cache entry only matters if the user is re-granted later and should have re-authed first, which is a degenerate case; Keycloak-side revocation has no direct signal and needs none — the next fork attempt safe-fails at the token-exchange call with `TokenExchangeFailed` before the cache is ever consulted.

Why the token rides in the ConfigMap rather than a K8s Secret:

- RBAC separation between Jobs, ConfigMaps, and Secrets is weak in our threat model — operators with `get jobs` typically also have `get configmaps` and `get secrets`; none of the three is a real trust boundary here.
- A ConfigMap-inlined token exists only for the Job's lifetime (plus TTL); a per-foreign-user Secret would outlive every individual turn and accumulate cruft on user revocation.
- DNS-1123 naming constraints, GC lifecycle, and a separate reconciliation loop for Secret resources are avoided.
- The fork ConfigMap is already the IPC carrier between api-server and controller (spec/status split, §5); reusing it for the token avoids a second K8s resource on the create/delete path.

OneCLI is unchanged — no new delegation header, no `act_as` semantics; the existing per-user agent registration model is sufficient.

### 5. Relay routing — API server requests a fork via a ConfigMap, controller reconciles

Fork-Job requests follow the existing ConfigMap-as-IPC pattern (agent-template, agent-instance, agent-schedule): the API server writes `spec.yaml`, the controller reconciles and writes `status.yaml`. No new tRPC endpoints, no direct API-server-to-controller calls.

New ConfigMap type: `platform.ai/type: agent-fork`.

- **`spec.yaml`** (API-server-owned): `{ version, instance, foreignSub, sessionId?, accessToken }` — identifies the instance to fork off, the foreign user whose identity the turn runs under, optionally the ACP session to resume, and the minted OneCLI access token that will be inlined into the Job env (§4).
- **`status.yaml`** (controller-owned): `{ version, phase: Pending|Ready|Failed|Completed, jobName, podIP?, error? }` — reports Job progress and the pod address once reachable. `error` carries `{ reason, detail? }` where `reason ∈ {CredentialMintFailed, OrchestrationFailed, PodNotReady, Timeout}`.

The API server's Slack relay, on a foreign-user reply:

1. Resolves the replier's `keycloakSub` from the Slack event.
2. If `keycloakSub == instance.owner`, opens an ACP connection to the main pod (current behavior).
3. Otherwise:
   a. Mints (or retrieves from cache) the foreign user's OneCLI access token (§4). On mint failure, posts an ephemeral error to Slack and stops — no fallback.
   b. Creates an `agent-fork` ConfigMap with `spec.yaml` containing the minted token.
   c. Polls the ConfigMap's `status.yaml` on a short interval (1 s default) until a terminal phase is reached. On `Ready`, reads `status.yaml.podIP`. (Polling, not an informer, because the single-turn lifetime, the short timeout budget, and the handful of concurrent forks make the simpler loop adequate; revisit if fork volume grows.)
   d. Opens an ACP connection to `podIP:8080` and relays the turn.
   e. On turn completion (ACP session closed or timeout), deletes the ConfigMap; controller's owner-reference cleanup removes the Job.

The controller's fork reconciler, watching `agent-fork` ConfigMaps:

1. Reads `spec.yaml.accessToken` (minted by the api-server — see §4). Does not itself mint tokens.
2. Collects agent-specific connector env vars by calling `factory.ClientForOwner(foreignSub).ListSecretsForAgent(...)` — this is the same secret-listing path used for the main pod, run under the foreign user's identity.
3. Creates the Job with the instance's RWX PVC, CA-cert init container, the inlined `ONECLI_ACCESS_TOKEN`, and the collected connector env vars. Writes `status.yaml` with `phase: Pending`.
4. Watches the Job's pod; once Ready with an IP, writes `status.yaml` with `phase: Ready` + `podIP`. If the 120 s deadline elapses first, writes `Failed{Timeout}`; on Job failure, `Failed{PodNotReady}`; on spec-parse or Job-apply errors, `Failed{OrchestrationFailed}`.
5. On fork ConfigMap deletion, the Job is garbage-collected via owner reference.

Session resumption works identically in both branches: the same `sessionId` in the `sessions` table (ADR-019) is passed to `unstable_resumeSession`, and the session state is read from the shared PVC.

### 6. Access control unchanged

ADR-018's two-tier gate (channel membership + per-instance allowed users) still runs against the replier's identity, as today. Impersonation piggybacks on the existing identity resolution — no new auth path.

### 7. Concurrency — explicitly deferred

The main pod and a fork Job could, in principle, run turns simultaneously (Alice uses the UI while Bob replies on Slack). Two processes writing to the same git working tree, the same `~/.claude` transcripts, and the same dependency caches can corrupt state.

For now: concurrency is out of scope. We accept the possibility of races until usage patterns show they matter. A follow-up ADR will introduce turn serialization (per-instance lock, queue, or leader election).

### 8. Non-Slack surfaces unaffected

Direct UI sessions, cron-triggered sessions (ADR-019), and MCP/harness-API traffic continue to use the instance owner's identity in the main pod. Per-turn forking is a Slack-channel-specific behavior because Slack is the only surface where multiple authenticated identities can drive the same instance.

## Alternatives Considered

**ACP `_meta` api-key swap (the original draft).** Rejected — not implementable. The OneCLI token is baked into `HTTPS_PROXY` at pod startup; the agent's child processes inherit the frozen env var. No runtime hook exists to redirect outbound traffic per turn.

**Sidecar HTTP proxy per pod that rewrites identity per turn.** A local proxy inside the pod forwards to the OneCLI gateway with a per-turn token selected by agent-runtime. Rejected: the sidecar would need to know turn boundaries (a new control channel), shares process/filesystem scope with the main pod (no credential isolation for real), and concurrent turns on the same pod would clash. The Jobs approach gives cleaner isolation at the K8s boundary.

**OneCLI `act_as` / delegation header.** API server sends its own token plus an `act_as: <sub>` header; OneCLI fork honors it for trusted callers. Rejected: adds a new trust boundary and delegation semantics in the OneCLI fork; the Jobs approach achieves the same outcome with unmodified OneCLI.

**Per-replier instance (fork the full instance on first foreign reply).** Each Slack user gets their own long-lived instance when they join a thread. Rejected: fragments the conversation across instances, explodes instance count, and defeats the shared-workspace value of threading. Jobs give us the same credential isolation without the long-lived fragmentation.

**Do nothing — instance owner is close enough.** Rejected: silently attributes actions to the wrong user and breaks on the first real team use case (PRs opened as the wrong author, wrong quotas hit, missing scopes).

**Thread-initiator identity as a fallback when the replier is unlinked.** Rejected: violates the principle that actions are attributed to whoever requested them. ADR-018 already requires identity linking; unlinked users are rejected at the relay, not silently impersonating someone else.

## Consequences

- Outbound API calls in a foreign-user Slack turn are attributed to the actual replier; PRs, issues, model usage, audit logs all match who asked for the action.
- Owner turns stay on the main pod — no regression in latency or behavior for the 80% case.
- Every Platform deployment must provision an RWX-capable storage class. The dev cluster (k3s-on-lima) ships with a workaround; prod deployments on managed K8s (EKS, GKE, AKS) already have RWX via EFS/Filestore/Azure Files.
- The api-server grows a `(instanceId, foreignSub) → accessToken` in-memory cache and the RFC 8693 token-exchange path in the `connections` module. The controller grows a new fork-Job creation path that reads the minted token from `spec.yaml.accessToken`. RFC 8693 impersonation ends up split across both processes (api-server for the OneCLI access token, controller for per-agent secret listing). No new persistent K8s resources (no per-foreign-user Secret).
- The API server gains a "fork path" in the Slack relay: detect foreign replier → mint foreign OneCLI token → create `agent-fork` ConfigMap with the token inlined → poll `status.yaml` until `phase == Ready` → proxy ACP to `status.yaml.podIP`. Job creation + pod Ready adds ~2–5 s cold-start latency per foreign turn; acceptable for Slack.
- A new ConfigMap type `platform.ai/type: agent-fork` is introduced, reusing the existing spec/status split. The fork path uses polling (not an informer) on the status field; see §5 for the rationale. No new CRDs or tRPC endpoints.
- OneCLI is unchanged — no new headers, no delegation flow; the fork burden from ADR-015 does not grow. The api-server's interactions with OneCLI are confined to `POST /api/agents` (with 409-idempotency fallback via `GET /api/agents`) and `PATCH /api/agents/{id}/secret-mode`, all on the existing public API.
- Shared workspace means Bob's Job and Alice's pod see the same `.git`, same `node_modules`, same `~/.claude`. Races are possible but deferred (§7).
- Jobs auto-clean (`ttlSecondsAfterFinished`). Credentials live in the fork ConfigMap's `spec.yaml.accessToken` for the Job's lifetime (plus TTL) and in the Job's env; they are not persisted elsewhere. Only the api-server's in-memory cache persists between turns.
- Non-Slack surfaces (UI, schedules, MCP) are unaffected and continue to run as the instance owner.
- Unlinked Slack repliers continue to be rejected at the relay (ADR-018 §2) — no impersonation fallback.
- Error paths: if Job creation, pod readiness, or credential minting fails for a given turn, the relay posts an ephemeral error to Slack and does not fall back to the instance owner's identity — failing closed is the safe default for credential routing.
