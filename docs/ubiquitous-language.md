# Ubiquitous Language

Domain terms used across this project. Each term is scoped to its bounded context, except for the cross-cutting Substrate vocabulary below.

## Substrate

Persistence vocabulary shared by every bounded context. See [`docs/architecture/persistence.md`](architecture/persistence.md) for the substrate split.

| Term | Definition |
|------|-----------|
| Infra State | State the Controller reconciles into running infrastructure. Stored in a ConfigMap with `spec.yaml` (api-server writer) and `status.yaml` (controller writer). |
| Application State | State only the API Server reads and writes; the Controller never touches it. Stored in PostgreSQL. |
| Workspace Volume | The persistent volume mounted into an Agent's pod that holds its workspace and `$HOME`. Always ReadWriteOnce — the Agent's pod is the volume's only writer. Identified by an owning-Agent + mount label, **not** by a reconstructed name — its name is not a stable contract. |
| Warm Pool | A controller-managed, leader-only background buffer of pre-provisioned, already-bound Spare workspace volumes, organized into per-size pools, that a newly created Agent claims at create time to skip first-start provisioning latency. Disabled by default. |
| Spare | An unclaimed Workspace Volume in the Warm Pool — provisioned and bound, waiting to be claimed. Carries a pool label and an available marker, and deliberately **no** owning-Agent label, so the orphan-volume sweep ignores it. |
| Claim (verb) | To assign a Spare to a newly created Agent: the controller relabels the Spare to that Agent in one atomic update, and the Agent mounts it as its Workspace Volume. A claimed Spare becomes an ordinary owned Workspace Volume — destroyed on Agent deletion, never returned to the pool. Distinct from the Kubernetes noun *PersistentVolumeClaim*. |
| Storage Migration | The controller's one-time, interrupt-safe drain of legacy shared-writable (RWX) Workspace Volumes onto ReadWriteOnce storage: force the Agent down, copy onto a fresh volume in a checksum-verified Job, re-point the Agent, delete the old volume, restore the prior run state. A no-op once no RWX volume remains; removed with the transitional window. |

## Agents (bounded context)

`Instance` is retired; the merged `Agent` carries definition, runtime state, and lifecycle.

| Term | Definition |
|------|-----------|
| Template | A read-only catalog blueprint that defines the base image, mounts, env, and resources for creating an agent |
| Agent | The durable, owned, runnable resource — definition, runtime state, and lifecycle. A custom resource whose `spec` (api-server writer) carries image, mounts, env, and secret refs, and whose `status` (controller writer) carries observed state. Optionally derived from a Template at create-time |
| Sandbox | The isolated container an Agent runs in. In user-facing copy, **Agent** is the primary word everywhere; "sandbox" appears only where the copy describes the container itself — isolation, images, inside/outside boundaries (#3216, which reverses the #892 rename). "Agent" is also the domain/code term |
| Agent Kind | A durable category marker on an Agent (create-time annotation, immutable) naming which first-class surface it also belongs to — `knowledge-base` or `experiment`. Absent on plain agents. The Home agents list shows every Agent regardless, badged with its Kind; the Knowledge Bases and Experiments destinations are filtered views onto the same agents, not exclusive homes. Declared intent, not a capability the platform enforces: what a marked agent gets is its Install Command's setup |
| Install Command | The one-shot shell command run in a Kinded Agent's workspace at create, delivered over the `workspace-command` rail. No agent turn — a workspace mutation, run once (sentinel-guarded), retried until it succeeds or the event's TTL lapses. Each Kind composes its own: a Knowledge Base bootstraps knowledge tooling from an external installer, an experiment agent copies in its authoring skill from a path staged in the image |
| workspace-command | A one-shot runtime-channel event (sibling of `workspace-seed`) that runs a platform-composed shell command once in the agent's work dir, in the pod's environment. Server-composed, never user free text |
| Backend | *(proposed, VM-sandbox proposal)* The isolation substrate an Agent's workload runs on, selected per-template as `spec.backend` — a discriminated union (`type: container \| vm`, default `container`, variant props in a sub-block named after the variant). `container` reconciles the agent StatefulSet (optionally Kata via `runtimeClassName`); `vm` reconciles a KubeVirt VirtualMachine. Not "Sandbox" (retired domain term) and distinct from `runtimeClassName`, which selects among *container* runtimes and is rejected on the `vm` backend |
| Session | One conversation with the agent harness, with its own lifecycle and metadata |
| Session Transcript | The in-memory record of one Session's messages, kept by agent-runtime. It has a size cap: when full, the oldest lines are dropped and readers are warned. Each attached channel remembers how far it has read, so it only receives what it missed. Not saved to disk — dies with the harness process. Distinct from the harness's own on-disk JSONL history (under `~/.claude/projects/…`), which outlives the process and backs `--resume`; this term never means that file |
| Prompt Scheduler | The agent-runtime module that runs each Session one turn at a time. A prompt arriving mid-turn is queued (up to a cap, then refused with a structured error) and promoted when the turn ahead ends; the scheduler tells the sender each prompt's fate — accepted, queued, started — over the sender's own channel. Queued prompts are a scheduling convenience, not a durable buffer: a leaver's go with them, and none survive the harness process |
| Harness Lease | The agent-runtime module that holds the harness child process on loan. It spawns the process when the first client needs it, holds early clients back until the env is ready at boot (bounded by a timeout), and recycles the process when the env changes — right away when idle, after work drains when busy, or after a grace period when forced. Every way the process goes down runs the same teardown with one reason: agent-exited, env-recycle, or shutdown. A crash is final for the pod; only an env recycle respawns |
| Session Bootstrap | The agent-runtime module that answers session/load and session/resume from the Session Transcript when it already holds the session. When the transcript is cold (first attach after a pod restart), at most one session/load per session goes to the harness and every other caller parks as a waiter; the replay fills the transcript, reaching only a client load's initiator, and the response serves all waiters from memory. Resume never reaches the harness, which hides harnesses that cannot resume |
| Pending Agent Requests | The agent-runtime module that holds each agent-initiated request (typically a permission prompt) open until a client answers. A new request fans out to the session's engaged channels; a channel that engages later is asked again on arrival; the first answer wins and later answers are dropped. A session-scoped request with no engaged channel expires after a TTL, answering the agent with a structured error so the tool call aborts cleanly. A request with no session broadcasts to every channel and never expires. Tearing a session down drops its requests the same way, since the session id is reused |
| Schedule | A time-triggered task attached to an Agent — either cron-based or heartbeat |
| Desired State | The target lifecycle state of an Agent: running or hibernated |
| Wake | Transitioning an Agent from hibernated to running |
| Hard Stop | User-initiated scale-to-zero of a running Agent (the `stop-requested` annotation), freeing its Reserved compute. Sticky against background activity — background polls cannot resurrect it — and cleared only by an explicit Wake or a Schedule fire (the UI warns at stop time when schedules exist) |
| Pause | User-initiated immediate hibernation: a Hard Stop whose stamp the api-server clears once the Agent settles Hibernated. Sticky only during the scale-down window (which is what prevents poll-resurrection mid-descent); afterwards the Agent wakes on any deliberate touch, back through the budget gate |
| Sweepable | *(proposed, PR #2816)* An Agent flagged for automatic deletion by the Agent Sweep. Set on ephemeral agents (Invocation targets now; the intended home for inherited channel agents later); durable owned Agents are never Sweepable. Radek's "annotation that marks an agent sweepable" |
| Agent Lifetime | *(proposed, PR #2816)* Optional grace period a Sweepable Agent may stay hibernated before the Agent Sweep deletes it. Default zero — deleted as soon as it hibernates. The knob that later lets an inherited channel agent linger warm (Radek's "2 days") while an Invocation target dies on hibernate. Distinct from the per-Invocation Liveness Deadline, which bounds one result, not the agent |
| Agent Sweep | *(proposed, PR #2816)* The owner-agnostic api-server GC that deletes a Sweepable Agent once it hibernates (after its Lifetime grace, if any) — the generic successor to the retired sandbox sweeper, keyed off Agent state, never the Invocations table. A terminal Invocation (done *or* failed) reaps its spawned target eagerly via `agents.delete`; the Sweep is the backstop for agents no Invocation reaps |
| Heartbeat | A recurring schedule type attached to an Agent, defined by interval and internally converted to cron |
| Reserved ID Prefix (agent-) | `agent-` — the prefix the controller mints onto every Agent ID; the api-server forbids Agent names that begin with it at create-time, and the CLI uses it as the ID-vs-name syntactic split signal |
| Keycloak User Directory | Infrastructure port resolving between user emails and Keycloak `sub` identifiers; backed by the Keycloak admin API |

## Channels (bounded context)

| Term | Definition |
|------|-----------|
| Channel | An external communication pathway connecting users to an Agent (e.g., Slack) |
| Channel Binding | The 1:1 linkage between a conversation surface (Slack channel, Telegram chat) and an Agent; a surface may be bound to at most one Agent globally; the binding itself is the authorization (see Shared Access); Agent delete, Slack disconnect, or Telegram `/platform unbind` / owner disconnect in the UI releases it |
| Channel Worker | A long-running process that bridges an external service to an Agent |
| Thread | A Slack conversation thread identified by its `thread_ts` timestamp; maps 1:1 to at most one Session per Agent |
| Shared Access | The one access model (per-person access modes are retired): the binding is the authorization — the Agent owner consents to a conversation surface, and anyone the messenger admits there may drive the Agent under the Agent's own credentials. No identity link; turns attributed by messenger-native sender id |

## Invocations (bounded context) — proposed, in-flight (PR #2816)

Replaces the first-cut "Sandbox" spawn record. The word *Sandbox* is retired as a domain term here (it collides with the #892 user-facing rename of Agent); what the spawn primitive actually models is a run-once, typed request from one Agent to another. Lifecycle (autosweep) is **not** here — it lives on the Agent (Sweepable / Agent Lifetime / Agent Sweep). This context owns only the result contract.

| Term | Definition |
|------|-----------|
| Invocation | A run-once request from a driver Agent to a target Agent: a `(driver, target, prompt, result schema) → one validated result` binding. Orthogonal to whether the target is ephemeral — pairing an Invocation with a freshly-spawned Sweepable Agent is the common case, not part of the definition |
| Driver | The Agent that creates an Invocation and polls it for the result. Attenuation ceiling: an Invocation's connections must be a subset of the driver's own grants |
| report_result | The fixed MCP tool the target Agent calls to report its result; the server validates it against the stashed Result Schema (structural only, never truth) and flips the Invocation terminal. Attribution is by the reporting agent's own id. *(renamed from the spawn/loop-era `node_done`)* |
| Result Schema | The driver-supplied JSON Schema an Invocation's result must match; stored on the Invocation record, never on any Kubernetes resource, so the platform stays blind to content |
| Liveness Deadline | The per-Invocation deadline (driver-set `ttlMs`, clamped ~1min..6h) after which a still-running Invocation is failed, so a target that exits silently can't wedge the driver's poll. Distinct from Agent Lifetime |
| Egress Aliasing | *(proposed, #2930)* An Invocation target has no egress identity of its own: the ext_authz gate resolves the target to its Driver — recursively, up to the root non-target Agent — before rule match, HITL hold, and approval write. All egress policy lives on the Driver and applies live to its running targets; approvals raised by target traffic belong to the Driver, stamped with the originating target for audit. Reach without credentials: the target gains the Driver's network reach, but the gateway still injects credentials per-agent |
| Driver Cascade | *(proposed, #2930)* Deleting a Driver fails its running Invocations and eagerly reaps their targets — transitively for chains — so no target keeps running or prompting against a deleted Driver's egress identity. Makes the dangling-driver state structurally unreachable; a target that slips through fails closed at the gate |
| Spend Attribution | *(proposed, #3041)* The third face of "a target is not an independent principal" (after Egress Aliasing and Driver Cascade), for Spend: an Invocation target's telemetry is attributed to its **root Driver**, so spend a Driver caused by delegating counts as the Driver's. Resolved at spawn time (the `invocations` row is not durable — targets are reaped ~10min after terminal — so a read-time join has nothing to join against) and stamped by the target's gateway as `platform.agent.id`; unresolvable chains fail the spawn closed, same as Egress Aliasing. See the Agent Attribution and `platform.invocation.id` entries under Metrics |

## Skills — api-server side (bounded context)

Catalog and orchestration view of skills. Distinct from the agent-runtime's Skills context — same words, different responsibilities. The api-server owns *which sources are connected, which skills are installed where, and what was published from which Agent*; it never manipulates files on a pod directly. Per [`docs/architecture/persistence.md`](../docs/architecture/persistence.md), every concept here is Application State and lives in Postgres or in api-server config.

| Term | Definition |
|------|-----------|
| Skill Source | A connected source of skills addressable by id; one of three kinds — user (Postgres row, owner-scoped), system (Seed List entry, cluster-admin-declared), or template (synthesised from a Template's `skillSources`) |
| Installed Skill Ref | A record that a Scanned Skill from a Skill Source is installed at a Version on a specific Agent; identity is `(agentId, source, name)` |
| Skill Publish Record | A record that a Local Skill from an Agent was published as a PR to a Skill Source; written on every successful Publish, denormalized so it survives source rename or deletion |
| Seed List | The cluster-admin-declared system Skill Sources injected as JSON into api-server config (`SKILL_SOURCES_SEED`) at startup; merged into Skill Source listings with `system: true` and protected from user deletion |

## Skills — agent-runtime side (bounded context)

Pod-side operational view of skills. Distinct from the api-server's Skills context — same words, different responsibilities. Agent-runtime owns *what files are where on this pod and how to mutate them*; it never reasons about source catalogs or drift.

| Term | Definition |
|------|-----------|
| Skill | A directory containing `SKILL.md` (with `name`/`description` frontmatter); the unit of installation |
| Skill Path | An absolute on-pod directory under which Skills are materialized; a Skill's identity within a path is the directory name |
| Local Skill | A Skill present in some Skill Path on this pod, regardless of whether it was installed from a Source or authored in place |
| Skill Source | A git repository URL that contains one or more Skills |
| Scanned Skill | A Skill discovered in a Source: `(source, name, description, version, contentHash)` where `version` is the Source's HEAD commit SHA at scan time |
| Content Hash | Deterministic SHA-256 over a Skill directory's file contents (sorted-path order, NUL-delimited); the drift signal produced — but not compared — on this side |
| Install | Materializing a Skill from a Source at a Version into one or more Skill Paths |
| Publish | Lifting a Local Skill to a GitHub repository as a new branch + PR via the REST API |
| Scan | Enumerating Scanned Skills in a Source |
| Write Local | Materializing user-supplied Markdown as a standalone Local Skill (one skill per file); rejects name collisions with existing Local Skills |
| Delete Local | Removing a standalone Local Skill's directory from every Skill Path; a name that resolves to no directory is a no-op |
| Read Local | Reading every file in a Local Skill's directory, size-capped per file and per skill; returns the resolved directory basename with the files |

## Approvals (bounded context)

| Term | Definition |
|------|-----------|
| Approval | A user-pending decision that gates either a credentialed egress request (ext_authz) or a harness tool call (acp_native); persisted in the `pending_approvals` table |
| Pending Approval | An approval whose verdict has not yet been decided; lives in the inbox |
| Inbox | The user-facing surface listing pending approvals — top-level page, sidebar bell with badge, and per-Agent tray |
| Verdict | The user's decision on a pending approval: `allow_once`, `allow`, `deny_once`, or `deny`. The `*_once` verdicts resolve only the held call (no rule written); `allow` / `deny` also write a permanent egress rule for ext_authz |
| Action Outcome | What an approval mutation reports back to the caller: `applied` (pending row settled), `rule_written_expired` (ext_authz hold already expired but the durable rule was written for future retries), or `not_actionable` (unknown, foreign, or already-settled id — deliberately indistinguishable), plus the egress `rule` that was written (`{host, method, pathPattern, verdict}`, or `null` when none) |
| Synth Frame | A synthetic ACP `session/request_permission` frame the relay injects into an attached client WS for an ext_authz approval; the synthetic session id has the `_egress:` prefix so the UI dispatches it to the inbox rather than the in-session permission queue |
| Held Call | An ext_authz request blocking on the API Server while it waits for a verdict, up to `approvalHoldSeconds` (default 30 minutes); durable pending row outlives the hold |
| ext_authz Gate | The application service that runs Envoy's HTTP ext_authz check: rule lookup, pending-row creation, synth-frame fan-out, synchronous hold, wake-up, expiry |
| Wrapper Response | A JSON-RPC response frame the inbox publishes when resolving an acp_native row; whichever replica holds the upstream WS for the Agent forwards it to the wrapper |
| Approvals Relay Service | Server-internal port the ACP relay consumes for mirror writes (record / resolve acp-native pending) and stream subscriptions (synth frames, wrapper responses) |

## Egress Rules (bounded context)

| Term | Definition |
|------|-----------|
| Egress Rule | A persistent allow/deny decision keyed on `(agent, host, method, path_pattern)`; matched on every ext_authz check before any user prompt |
| Rule Verdict | `allow` or `deny` — the decision a rule encodes |
| Rule Match | Lookup of the most-specific active rule for a given egress request; misses fall through to the ext_authz Gate's pending-approval flow |
| L7 Promotion | Putting a rule's host onto the gateway's TLS-terminating (L7) chain so path/method/port narrowing is enforceable over HTTPS — the L4 catch-all sees only SNI. Per-agent intent on the Agent resource (`l7Hosts`), written by the api-server when such a rule exists |

## Connections (bounded context) — proposed, in-flight design

Generalises today's split between `OAuthAppDescriptor` (OAuth-app registry) and `ProviderPreset` (typed-secret registry) into one model. Terms below are in active design; structure (subtype axes, push channel, capability negotiation) is being grilled.

| Term | Definition |
|------|-----------|
| Connection Template | A code-level catalog entry that ships defaults — pre-filled `AuthConfig` and `Contribution[]` plus the input fields the user fills in. Premade templates (e.g. GitHub, Anthropic) and "Custom" templates (MCP server, OAuth, Header) share the same shape. Carries two display-axis attributes: `category` (`app` \| `mcp` \| `other`) for UI grouping, and `isCustom` (boolean) marking templates that exist solely to generate user-typed connections. Replaces today's `OAuthAppDescriptor` + `ProviderPreset` parallel registries |
| Connection | A single uniform shape: `{ auth: AuthConfig \| null, contributions: Contribution[], inputs, templateId? }`. No `kind` discriminator — identity is the contributions it makes and the auth it carries. A user-built Connection can be contribution-equivalent to a premade one |
| Contribution | One typed unit a Connection emits for one Agent when granted. Kinds (provisional, extensible): `env`, `egress-host`, `file`, `mcp-entry`, `skill-ref`. Discriminated union; new kinds add by extending the union |
| AuthConfig | Discriminated union describing how a Connection authenticates. Kinds (provisional, extensible): `oauth`, `header`, `none`. The `header` kind covers any header-injected static credential (API keys, PATs, bearer tokens, basic auth) — distinguished only by `headerName` + `valueFormat`. Separate from contributions because credentials have their own lifecycle (refresh, rotation) |
| State Slice | A declarative full snapshot of an Agent's desired Contributions, delivered alongside the Events slice in `applyState`. Carries a deterministic content hash so the agent can short-circuit reconciliation when unchanged. Idempotent and replay-safe |
| Event | A one-shot directive (e.g. `trigger` — fire a session) carried in the `events[]` slice of `applyState`. Processed by the agent in order through a per-kind handler on the harness API. Each event carries its own slot in the agent's monotonic version sequence; the handler is idempotent on the event's stable id via a unique constraint on its side-effect table |
| Version (per-agent) | A monotonic counter per Agent, bumped on every contribution edit or event insert. Lives top-level in the `applyState` payload; the agent reports its progress against it as it settles state and events |
| Settled Version | The last `version` whose apply cycle ran to termination — success *or* with failures. Advances on every settle regardless of per-driver outcome. Recorded as `runtime_state_outbox.last_settled_version`. Always `>=` Last Applied Version |
| Last Applied Version | The agent's last *fully-applied* `version` — advances only when a settle completes with no driver failures. Reported on `hello` and `applyState` ack. Server rejects older state pushes (cross-replica race defense) and stamps events with `version <= appliedVersion` as dispatched |
| Last Applied Hash | The agent's last *fully-applied* Contribution hash. Server skips retransmission of the state slice when it matches; a failing settle leaves it behind so the retry re-dispatches every contribution |
| Apply Failures | The drivers that failed the most recent settle (`runtime_state_outbox.apply_failures`, a `DriverFailure[]`). Drives the background retry (capped by `apply_attempts`) and the per-kind notifications — failed / recovered, plus a terminal *gave-up* when a kind exhausts the retry cap. The failed/recovered/gave-up diff is computed under a row lock in `recordOutcome` so concurrent workers can't double-emit. A version bump clears them (stale by definition). Surfaced on the Agent as `contributionFailures` (the degraded badge). Empty ⇒ healthy |
| Contributions Settled | The settlement fact "the agent has terminated reconciliation for the current desired Version" — true when `runtime_state_outbox.last_settled_version >= version` (or there is no outbox row, i.e. nothing to apply). Does *not* assert per-driver success: an agent is Settled with non-empty Apply Failures. Drives the background **retry** — the sweep re-dispatches any row that is not Settled, or is Settled-with-failures under the attempt cap. On this iteration it does **not** gate readiness: readiness is the controller-published `Ready` condition and the apply worker dispatches only to a Ready agent (`isReady`). Gating readiness on settlement is deferred. |

## Experiments (bounded context)

An Experiment is *one execution of a driver Agent's loop script* — a design→build→test→learn loop written as code over the Invocation primitive (#2821) — observed live by the platform. The platform never runs the optimization loop and never interprets a score: the loop's shape lives in code, and the code reports its shape. (The earlier arms-racing model — Arms, Trials, Arm Variations, Run Ledger — was removed by #2822; the owner-scoped resource, UI destination, and feature flag carried over.)

| Term | Definition |
|------|-----------|
| Experiment | Building and running are separate lifecycles sharing one table. The **draft** (plan registered) is source: it persists, re-registrations update it. A **run** is an immutable capture started from the draft: its own row (`running` → `completed`/`failed`/`stopped`) with the draft's declaration and its own cloned artifacts. A draft never becomes a run; a run never reopens |
| Driver Agent | The Agent an Experiment runs on. Usually one created as an experiment agent (the `experiment` Agent Kind), which is what installs the authoring skill — but the marker is intent, not a gate: Plan Registration is keyed only on the calling agent's identity, so any Agent that registers a plan is a Driver Agent too. The Experiments destination therefore lists both — marked agents (even with no experiments yet) and unmarked agents that registered one |
| Skeleton | The stage/loop/fork structure the script declares upfront, registered before execution. Lenient: a span naming an undeclared stage grows the graph and is marked as drift, never an error |
| Stage / Span | Stage = one declared skeleton node (produce, eval, select, …). Span = one execution of a stage, iteration-keyed, carrying status, timings, an optional numeric Score (captured, plotted, never normalized — the old bet survives), Artifact references, and an opaque `attrs` JSON bag |
| Trace | The append-only stream of spans plus attached Invocations for one Experiment, held by the platform (SDK reports over the per-agent HTTP surface; the browser being closed never pauses a run) |
| Trace Feed | The bounded JSON projection of Skeleton + Trace the platform serves (per-stage aggregates, downsampled score series, recent spans, attached Invocations); the one contract shared by the SDK docs, the stock and bespoke Dashboard Artifacts, and the UI. Polled only while a run is live |
| Experiment SDK | `experiment_sdk` — Python, stdlib-only, baked into platform-base on `PYTHONPATH` (pydantic accepted via duck typing, never required). Subsumes the driver surface — `spawn` / `list_images` / `list_connections` / `s()` — plus the skeleton/span API. `spawn()` inside `with stage.run():` auto-attaches to the active span via contextvar (`span=` override for fan-out). The JS driver-sdk stays for generic non-experiment loops |
| Plan Registration | Running the script without an Execute context (`python exp.py --plan`, or just by hand): declarations execute, the loop body doesn't; the Skeleton plus a script capture post to the platform, creating (or refreshing) the `draft` Experiment — its panel docks in the driver's chat with an Execute button |
| Start a run | UI action on a lineage (from the draft's panel or a finished run's): clones the draft — run row + script clone (the run renders the draft's dashboard while live) — then an `experiment-execute` runtime-channel event delivers the composed launch prompt and the harness starts the script as a detached background process with `PLATFORM_EXPERIMENT_ID` set; the script reports for itself from then on. The draft stays a draft |
| Script Artifact | The draft's script source in the Artifact Library — re-registrations publish new versions, so its history is the build history. Each run gets its own frozen clone at start. Everything platform-managed lives in the lineage's own folder (`Experiments / <name>`), keeping the library root clean. Source is never stored in Postgres |
| Dashboard Artifact | The HTML renderer of the Trace Feed, in the Artifact Library: the draft carries a stock dashboard (with the plan's skeleton baked in) or an agent-generated bespoke one (`dashboard_path`). Renders in a sealed iframe — the panel that self-docks in the driver's chat — with data arriving via the postMessage bridge (host page polls the feed and pushes JSON in — the first capability of the Interactive Artifacts direction, #2884), so generated HTML holds no credentials and the sandbox never gains network. A live run renders the draft's dashboard; at the terminal transition the platform mints the run's own single-version **results artifact** (renderer + final feed baked in) — download it, share it, it renders anywhere with no bridge — and the draft's dashboard stays clean for building |
| Candidate | An artifact a span references (`span.artifact(id)`), stored in the Artifact Library — published by the producing invocation target or the driver |
| Pin | A running Experiment vetoes hibernation of its driver Agent (`agent-platform.ai/experiment-active`, subordinate to a hard stop); released when the driver's last running experiment goes terminal, reconciled against database truth at boot. The inactivity sweep failing a silent run is what un-pins a crashed loop's driver |
| Inactivity sweep | The liveness backstop: a `running` Experiment with no accepted trace event within `EXPERIMENT_INACTIVITY_SECONDS` (default 15 min; clock basis falls back to Execute time) is reaped to `failed`, so every executed Experiment reaches a terminal state |
| Trace writers | Driver-only: targets speak through their schema-validated result and published artifacts. Multi-writer (target spans nesting under the spawning span) is the planned fast-follow that gives long-running framework nodes mid-flight visibility |

## Knowledge Bases (bounded context)

A Knowledge Base is an Agent that builds and maintains a body of knowledge the user works with through chat. The platform owns the pairing, not the knowledge: no ingestion pipeline, no query API, no schema — the agent bootstraps its own tooling. Phase 1 of epic #2796.

| Term | Definition |
|------|-----------|
| Knowledge Base | An Agent carrying the `knowledge-base` Agent Kind, bootstrapped by an Install Command at create. Everything else about it is a plain Agent — lifecycle, sessions, connections, schedules, budgets |
| KB Template | The installation procedure a Knowledge Base is created from, surfaced to the user as "Template" (distinct from the harness image, which v1 pins and hides). Two today — LLM Wiki (a toolkit) and Plain Wiki (markdown-only, offline). The server maps the template id to its Install Command; a new procedure is a new id plus a new mapping, and its bootstrap must install a `/wiki-onboard` command (the greeting depends on it) |

## Secrets (bounded context)

| Term | Definition |
|------|-----------|
| Secret | A user-owned credential (e.g., an Anthropic API key) stored as a K8s Secret labelled with the owner's `sub` and mounted into the agent pod's Envoy sidecar for wire-level injection on outbound traffic |
| Secret Type | The provider taxonomy for a secret — currently `anthropic` (hostPattern fixed) or `generic` (user-supplied host/path patterns) |
| Host Pattern | The hostname pattern that identifies which outbound requests the Envoy sidecar should inject this secret into |
| Secret Assignment | The linkage between a Secret and an Agent that makes the secret available to that Agent's egress; stored as the `agent-platform.ai/secret-mode` + `agent-platform.ai/granted-secret-ids` annotations on the Agent ConfigMap |
| Provider | The external service a secret authenticates against (e.g., Anthropic); for typed secrets the provider determines default routing rules |

## Terms (bounded context)

| Term | Definition |
|------|-----------|
| Terms of Use | The legal contract a user must accept before driving Platform through any authenticated surface; text and version sourced from Helm values (`terms.text`, `terms.version`) |
| Terms Version | A free-form string in Helm values that the operator bumps when a change is material; the gate compares the user's latest accepted version against it to decide re-prompting |
| Terms Hash | sha256 of the current Terms of Use text, computed at api-server boot; recorded on every Acceptance for proof — never compared by the gate |
| Acceptance | A per-(user, version) record proving a user accepted a specific Terms Version, written when they POST to `/api/terms/accept`; append-only history in `terms_acceptances` |
| Acceptance Gate | The api-server middleware on the public port that refuses every request from a sub whose latest Acceptance row doesn't match the current Terms Version, returning 412 with `{ currentVersion, currentHash }` |
| Stale Acceptance | The state of a sub whose latest Acceptance is for an older Terms Version than the current one; the gate refuses them until they accept again |

## Usage Tracking (bounded context)

| Term | Definition |
|------|-----------|
| Activity Event | An append-only `activity_events` row capturing one semantically-meaningful interaction — arriving (auth), working with an agent (turns, relay attach, schedule fire, file import, invocation), setting one up (connections, skills, harness config, Kinded Agent create), sharing what came out (artifact publish, share-link view), and the account surfaces around it (experiment runs, feature flags, API keys). Carries actor, agent, surface, outcome, and event-type-specific payload |
| Session Turn | One prompt a user sent directly at an Agent's Session — the browser chat and `dam chat` both reach the agent through the same relay, so both produce one. The direct-path counterpart of a Channel Turn. Counted when the prompt is sent rather than when the reply lands, so the count does not depend on the transport surviving the turn and is not skewed by network or provider failures |
| Relay Attach | A user opening a live channel onto an Agent's pod — a prompt channel or an interactive shell. For a shell it is the only thing recorded: what happens inside is never inspected, so "was this surface used, and by whom" is the strongest question it can answer. Collapsed to one row per user, agent, relay kind and day, because the relay reconnects on a timer and the raw stream counts handshakes rather than people |
| Surface | Where an interaction came from. For a user action it is the client, derived once from the authenticated party (`ui`, `cli`, `other`) and stamped on every Activity Event rather than only on the auth fact, so a turn's surface and a login's surface mean the same thing. The column is wider than that: it also carries a Channel's own name, the originating machinery for events no client drove (`scheduler`, `share-host`, `mcp`), a Connection's category on connection rows, and null where none applies. Read it as the origin of the row, and compare client surfaces only within event types that have one |
| Actor Sub | The pseudonymized identifier of the user who triggered an Activity Event — `HMAC-SHA256(ACTIVITY_HMAC_KEY, keycloak_sub)` rendered as hex. Joinable across `activity_events`, `actor_roles`, and `agents.owner_sub` because the same key is used everywhere |
| Sub Pseudonymizer | The repository-boundary helper that applies the HMAC to every `sub` before it reaches Postgres — single chokepoint, raw subs stay in-process only |
| Activity Outcome | A `success` / `failure` Postgres enum on every Activity Event — no default, so a missing outcome surfaces as a constraint violation rather than silently miscounting |
| Agent Mirror | The Postgres `agents` table — a per-install projection of agent ConfigMaps that lets SQL views resolve `agent_id → owner_sub` without a K8s API round-trip; populated by an event saga + startup K8s scan |
| Inspector | A Keycloak user carrying the configured inspector realm role (`platform-inspector` by default) who can read `/api/usage/*` but is otherwise indistinguishable from a regular platform user |
| Usage View | A named SQL view (`usage_*`) that aggregates Activity Events into an operator-facing metric. View names form the public read API; consumers never query the raw table |
| Pilot Metric Filter | The `WHERE actor_sub NOT IN (SELECT … FROM usage_core_actor_subs)` clause (or its `agent_id` / `owner_sub` analogue) applied on every pilot Usage View to exclude core-team activity — keyed on `actor_roles.is_core`, populated from JWT `realm_access.roles` at auth time |

## Metrics (bounded context)

The user-facing spend read path over agent telemetry — owner-scoped reads that back the Settings Usage tab. Distinct from Usage Tracking, which is activity analytics (who did what, when): tokens and cost are Spend, and live here. See [`docs/architecture/metrics.md`](architecture/metrics.md).

| Term | Definition |
|------|-----------|
| Spend | An agent's LLM token and cost consumption, read live from the telemetry store as token counters and a per-call cost. Agent-reported and so not content-trusted (an agent can misreport its own numbers); the read path reports what was exported. The tokens/cost concept — as opposed to Usage Tracking's activity analytics or a Budget's concurrent reservation |
| Spend Breakdown | Spend sliced along a dimension for the Usage tab — per model, per session, per call, or per agent over a time window. The same underlying Spend rolled up different ways; a window may narrow to one owned agent or an exact (trace-aware) session, else covers all of the caller's agents |
| Agent Attribution | The binding of a telemetry record to the agent that produced it, carried by the gateway-stamped `platform.agent.id` resource attribute — trusted and unforgeable because the agent's paired gateway overwrites it and the collector drops any value not stamped there. The sole authority for whose Spend a record is; the agent-exported `platform.agent.name` is display-only and never used for scoping. An Invocation target is not a Spend principal of its own — the spend face of the rule Egress Aliasing and Driver Cascade already hold: its gateway stamps its **root Driver's** id here, decided at spawn time, so its Spend rolls up under the Driver by construction while its `platform.agent.name` stays its own |
| `platform.invocation.id` | The trusted, gateway-stamped resource attribute carrying an Invocation target's **own** id on records whose `platform.agent.id` has been overridden to its root Driver — the one thing keeping child rows distinguishable once their attribution is deliberately merged into the Driver. Sanitized by the collector exactly like `platform.agent.id` (dropped unless gateway-stamped), and stripped for non-targets so it can never be forged. Read-path use: excluded from the per-agent Spend label so a Driver is never relabelled to a target's throwaway `invocation-<hex>` name |

## Budgets (bounded context)

Fair-sharing of the cluster's fixed compute pool between users. Distinct from Spend under Metrics (tokens/cost accounting) — a Budget bounds *concurrent reservation*, never spend. Enforcement lives in the controller at the 0→1 scale transition; the api-server only displays and explains.

| Term | Definition |
|------|-----------|
| Budget | A per-user ceiling on concurrently Reserved compute (CPU and memory) across that user's Agents. Constrains *starting* an Agent, never *running* one — no eviction on ceiling changes |
| Ceiling | The limit side of a Budget: the operator-set maximum Reserved compute for one user. Resolved as the user's UserBudget override, else the chart-wide default |
| Reserved | The consumption side of a Budget: the sum of Sizes (`spec.resources.limits`) across an owner's scaled-up Agents. Limits hard-cap usage, so a user's Agents can never consume past their Ceiling — a deterministic guarantee. Excludes the uniform per-agent gateway overhead and per-command Run pods |
| Size | An Agent's user-facing power: its CPU/memory limits, chosen by slider at create (else the template's default, else the small chart default of 1 CPU/1Gi). The one resource concept users see — pod requests are scheduling internals derived at render (`max(limit × fraction, floor)`) |
| UserBudget | The record of one user's Ceiling override: a namespaced CR (platform namespace, like Agent) named `budget-<sub>` whose `spec.owner` carries the exact plaintext Keycloak sub (name↔owner pinned by schema validation). Absence means the chart default applies |
| Over Budget | The parked state of an Agent whose start would push its owner's Reserved past their Ceiling: pods stay at zero, `Ready=False/OverBudget`. Parked Agents never start by themselves — a new deliberate start (Start button, opening it, a Schedule fire) retries the gate; never-hibernate Agents are the exception and auto-start when room frees. The activity window lapsing reverts it to plain hibernation |

## Platform CLI (bounded context)

| Term | Definition |
|------|-----------|
| Platform CLI | The `dam` command-line client that talks to a hosted Platform deployment from the user's terminal; package at `packages/cli/` |
| Config | The CLI's resolved settings for the current invocation — currently only the target Server URL |
| Config Source | One of the three inputs the Config is resolved from: command-line flag, environment variable, or config file |
| Server URL | The Platform deployment the CLI is configured to talk to |
| Compat Verdict | The result of comparing the local CLI's version against the server's reported `minClientVersion` and current version: `Ok`, `BehindMinClient` (hard-refuse), or `BehindCurrent` (soft-warn) |
| Active Host | The Server URL the CLI sends commands to by default — resolved from `--server` flag, env var, or `config.toml` in that order. Also the key into the Auth Store for the credential a given invocation should use |
| Host Auth | The per-Host credential record persisted by `dam auth login` — issuer, username, sub, the rotated access/refresh tokens, and the access token's expiry instant |
| Auth Store | The machine-managed credential file at `$XDG_STATE_HOME/dam/auth.toml` (mode 0600, atomic writes) holding Host Auth entries keyed by Host URL — distinct from Config, which is user-editable |
| Token Provider | The single cross-module application service every authenticated CLI verb calls to obtain a valid bearer for a Host — owns `DAM_TOKEN` precedence, proactive refresh within 60s of expiry, and the `invalid_grant` → clear-creds policy |
| CLI Client | The Platform CLI's public OAuth client registered in Keycloak (`platform-cli` by default, advertised as `cliClientId` on `/api/auth/config`); device-grant only, no client secret, no redirect URIs |
| Agent Ref | The user-supplied string that addresses an Agent from the CLI — either an Agent ID (anything starting with the Reserved ID Prefix `agent-`) or an Agent name, disambiguated syntactically |
| Agent Resolver | The cross-module application service every Agent-targeted CLI verb consumes to convert an Agent Ref into the owner's Agent; exact case-sensitive name match; returns a typed not-found / ambiguous / transport / auth-required error |