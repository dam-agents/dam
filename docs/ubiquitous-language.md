# Ubiquitous Language

Domain terms used across this project. Each term is scoped to its bounded context, except for the cross-cutting Substrate vocabulary below.

## Substrate

Persistence vocabulary shared by every bounded context. See [`docs/architecture/persistence.md`](architecture/persistence.md) for the substrate split.

| Term | Definition |
|------|-----------|
| Infra State | State the Controller reconciles into running infrastructure. Stored in a ConfigMap with `spec.yaml` (api-server writer) and `status.yaml` (controller writer). |
| Application State | State only the API Server reads and writes; the Controller never touches it. Stored in PostgreSQL. |
| Workspace Volume | The persistent volume mounted into an Agent's pod that holds its workspace and `$HOME`. Identified by an owning-Agent + mount label, **not** by a reconstructed name — its name is not a stable contract. |
| Warm Pool | A controller-managed, leader-only background buffer of pre-provisioned, already-bound Spare workspace volumes, organized into per-size pools, that a newly created Agent claims at create time to skip first-start provisioning latency. Disabled by default. |
| Spare | An unclaimed Workspace Volume in the Warm Pool — provisioned and bound, waiting to be claimed. Carries a pool label and an available marker, and deliberately **no** owning-Agent label, so the orphan-volume sweep ignores it. |
| Claim (verb) | To assign a Spare to a newly created Agent: the controller relabels the Spare to that Agent in one atomic update, and the Agent mounts it as its Workspace Volume. A claimed Spare becomes an ordinary owned Workspace Volume — destroyed on Agent deletion, never returned to the pool. Distinct from the Kubernetes noun *PersistentVolumeClaim*. |

## Agents (bounded context)

`Instance` is retired; the merged `Agent` carries definition, runtime state, and lifecycle.

| Term | Definition |
|------|-----------|
| Template | A read-only catalog blueprint that defines the base image, mounts, env, and resources for creating an agent |
| Agent | The durable, owned, runnable resource — definition, runtime state, and lifecycle. A single ConfigMap whose `spec.yaml` (api-server writer) carries env, secret refs, allowed users, and `desiredState`, and whose `status.yaml` (controller writer) carries observed state. Optionally derived from a Template at create-time |
| Sandbox | The user-facing name for an Agent across the redesigned UI (#892); "Agent" remains the domain/code term |
| Session | One conversation with the agent harness, with its own lifecycle and metadata |
| Schedule | A time-triggered task attached to an Agent — either cron-based or heartbeat |
| Desired State | The target lifecycle state of an Agent: running or hibernated |
| Wake | Transitioning an Agent from hibernated to running |
| Heartbeat | A recurring schedule type attached to an Agent, defined by interval and internally converted to cron |
| Reserved ID Prefix (agent-) | `agent-` — the prefix the controller mints onto every Agent ID; the api-server forbids Agent names that begin with it at create-time, and the CLI uses it as the ID-vs-name syntactic split signal |
| Keycloak User Directory | Infrastructure port resolving between user emails and Keycloak `sub` identifiers; backed by the Keycloak admin API |

## Channels (bounded context)

| Term | Definition |
|------|-----------|
| Channel | An external communication pathway connecting users to an Agent (e.g., Slack) |
| Channel Binding | The 1:1 linkage between a Slack channel and an Agent; a Slack channel may be bound to at most one Agent globally; Agent delete or Slack disconnect releases the binding |
| Channel Worker | A long-running process that bridges an external service to an Agent |
| Thread | A Slack conversation thread identified by its `thread_ts` timestamp; maps 1:1 to at most one Session per Agent |
| Foreign Replier | A linked Slack user in an Agent's `allowedUsers` list whose identity differs from the Agent owner; triggers a Fork for the turn |

## Forks (bounded context)

| Term | Definition |
|------|-----------|
| Fork | An ephemeral, per-turn execution environment derived from an Agent that impersonates a foreign user for the duration of one Slack turn. Job-shaped and run-to-completion — distinct from the Agent's StatefulSet shape |
| Foreign Sub | The Keycloak `sub` of a Slack replier who is not the Agent owner |
| Fork Phase | The lifecycle state of a Fork: Pending, Ready, Failed, or Completed |

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
| Skill Source | A git repository URL that contains one or more Skills under `skills/*` or top-level `*` |
| Scanned Skill | A Skill discovered in a Source: `(source, name, description, version, contentHash)` where `version` is the Source's HEAD commit SHA at scan time |
| Content Hash | Deterministic SHA-256 over a Skill directory's file contents (sorted-path order, NUL-delimited); the drift signal produced — but not compared — on this side |
| Install | Materializing a Skill from a Source at a Version into one or more Skill Paths |
| Publish | Lifting a Local Skill to a GitHub repository as a new branch + PR via the REST API |
| Scan | Enumerating Scanned Skills in a Source |

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
| Activity Event | An append-only `activity_events` row capturing one semantically-meaningful interaction — auth, channel turn, schedule fire, OAuth connection lifecycle, file import. Carries actor, agent, surface, outcome, and event-type-specific payload |
| Actor Sub | The pseudonymized identifier of the user who triggered an Activity Event — `HMAC-SHA256(ACTIVITY_HMAC_KEY, keycloak_sub)` rendered as hex. Joinable across `activity_events`, `actor_roles`, and `agents.owner_sub` because the same key is used everywhere |
| Sub Pseudonymizer | The repository-boundary helper that applies the HMAC to every `sub` before it reaches Postgres — single chokepoint, raw subs stay in-process only |
| Activity Outcome | A `success` / `failure` Postgres enum on every Activity Event — no default, so a missing outcome surfaces as a constraint violation rather than silently miscounting |
| Agent Mirror | The Postgres `agents` table — a per-install projection of agent ConfigMaps that lets SQL views resolve `agent_id → owner_sub` without a K8s API round-trip; populated by an event saga + startup K8s scan |
| Inspector | A Keycloak user carrying the configured inspector realm role (`platform-inspector` by default) who can read `/api/usage/*` but is otherwise indistinguishable from a regular platform user |
| Usage View | A named SQL view (`usage_*`) that aggregates Activity Events into an operator-facing metric. View names form the public read API; consumers never query the raw table |
| Pilot Metric Filter | The `WHERE actor_sub NOT IN (SELECT … FROM usage_core_actor_subs)` clause (or its `agent_id` / `owner_sub` analogue) applied on every pilot Usage View to exclude core-team activity — keyed on `actor_roles.is_core`, populated from JWT `realm_access.roles` at auth time |

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