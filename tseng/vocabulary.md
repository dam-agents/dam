# Ubiquitous Language

Domain terms used across this project. Each term is scoped to its bounded context, except for the cross-cutting Substrate vocabulary below.

## Substrate

Persistence vocabulary shared by every bounded context. See [`docs/architecture/persistence.md`](../docs/architecture/persistence.md) for the substrate split.

| Term | Definition |
|------|-----------|
| Infra State | State the Controller reconciles into running infrastructure. Stored in a ConfigMap with `spec.yaml` (api-server writer) and `status.yaml` (controller writer). |
| Application State | State only the API Server reads and writes; the Controller never touches it. Stored in PostgreSQL. |

## Agents (bounded context)

| Term | Definition |
|------|-----------|
| Template | A read-only catalog blueprint that defines the base image, mounts, env, and resources for creating an agent |
| Agent | A user-owned definition of a runnable AI harness, optionally derived from a template |
| Instance | A running (or hibernated) deployment of an agent with its own state and environment; aggregate root assembled from Infra State (desiredState, env, secretRef) and Application State (channels, session metadata) |
| Session | One conversation with the agent harness, with its own lifecycle and metadata |
| Schedule | A time-triggered task attached to an instance — either cron-based or heartbeat |
| Desired State | The target lifecycle state of an instance: running or hibernated |
| Wake | Transitioning an instance from hibernated to running |
| Heartbeat | A recurring schedule type defined by interval, internally converted to cron |
| Keycloak User Directory | Infrastructure port resolving between user emails and Keycloak `sub` identifiers; backed by the Keycloak admin API |

## Channels (bounded context)

| Term | Definition |
|------|-----------|
| Channel | An external communication pathway connecting users to an agent instance (e.g., Slack) |
| Channel Binding | The 1:1 linkage between a Slack channel and an Instance; a Slack channel may be bound to at most one Instance globally; Instance delete or Slack disconnect releases the binding |
| Channel Worker | A long-running process that bridges an external service to an agent instance |
| Thread | A Slack conversation thread identified by its `thread_ts` timestamp; maps 1:1 to at most one Session per Instance |
| Foreign Replier | A linked Slack user in an instance's `allowedUsers` list whose identity differs from the Instance owner; triggers a Fork for the turn |

## Forks (bounded context)

| Term | Definition |
|------|-----------|
| Fork | An ephemeral, per-turn execution environment derived from an Instance that impersonates a foreign user for the duration of one Slack turn |
| Foreign Sub | The Keycloak `sub` of a Slack replier who is not the Instance owner |
| Fork Phase | The lifecycle state of a Fork: Pending, Ready, Failed, or Completed |

## Skills — api-server side (bounded context)

Catalog and orchestration view of skills. Distinct from the agent-runtime's Skills context — same words, different responsibilities. The api-server owns *which sources are connected, which skills are installed where, and what was published from which instance*; it never manipulates files on a pod directly. Per [`docs/architecture/persistence.md`](../docs/architecture/persistence.md), every concept here is Application State and lives in Postgres or in api-server config.

| Term | Definition |
|------|-----------|
| Skill Source | A connected source of skills addressable by id; one of three kinds — user (Postgres row, owner-scoped), system (Seed List entry, cluster-admin-declared), or template (synthesised from a Template's `skillSources`) |
| Installed Skill Ref | A record that a Scanned Skill from a Skill Source is installed at a Version on a specific Instance; identity is `(instanceId, source, name)` |
| Skill Publish Record | A record that a Local Skill from an Instance was published as a PR to a Skill Source; written on every successful Publish, denormalized so it survives source rename or deletion |
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
| Inbox | The user-facing surface listing pending approvals — top-level page, sidebar bell with badge, and per-instance tray |
| Verdict | The user's decision on a pending approval: `allow_once`, `allow`, or `deny` |
| Synth Frame | A synthetic ACP `session/request_permission` frame the relay injects into an attached client WS for an ext_authz approval; the synthetic session id has the `_egress:` prefix so the UI dispatches it to the inbox rather than the in-session permission queue |
| Held Call | An ext_authz request blocking on the API Server while it waits for a verdict, up to `approvalHoldSeconds` (default 30 minutes); durable pending row outlives the hold |
| ext_authz Gate | The application service that runs Envoy's HTTP ext_authz check: rule lookup, pending-row creation, synth-frame fan-out, synchronous hold, wake-up, expiry |
| Wrapper Response | A JSON-RPC response frame the inbox publishes when resolving an acp_native row; whichever replica holds the upstream WS for the instance forwards it to the wrapper |
| Approvals Relay Service | Server-internal port the ACP relay consumes for mirror writes (record / resolve acp-native pending) and stream subscriptions (synth frames, wrapper responses) |

## Egress Rules (bounded context)

| Term | Definition |
|------|-----------|
| Egress Rule | A persistent allow/deny decision keyed on `(agent, host, method, path_pattern)`; matched on every ext_authz check before any user prompt |
| Rule Verdict | `allow` or `deny` — the decision a rule encodes |
| Rule Match | Lookup of the most-specific active rule for a given egress request; misses fall through to the ext_authz Gate's pending-approval flow |

## Secrets (bounded context)

| Term | Definition |
|------|-----------|
| Secret | A user-owned credential (e.g., an Anthropic API key) stored as a K8s Secret labelled with the owner's `sub` and mounted into the agent pod's Envoy sidecar for wire-level injection on outbound traffic |
| Secret Type | The provider taxonomy for a secret — currently `anthropic` (hostPattern fixed) or `generic` (user-supplied host/path patterns) |
| Host Pattern | The hostname pattern that identifies which outbound requests the Envoy sidecar should inject this secret into |
| Secret Assignment | The linkage between a Secret and an Agent that makes the secret available to that agent's egress; stored as the `agent-platform.ai/secret-mode` + `agent-platform.ai/granted-secret-ids` annotations on the agent's instance ConfigMap |
| Provider | The external service a secret authenticates against (e.g., Anthropic); for typed secrets the provider determines default routing rules |

## Platform CLI (bounded context)

| Term | Definition |
|------|-----------|
| Platform CLI | The `dam` command-line client that talks to a hosted Platform deployment from the user's terminal; package at `packages/cli/` |
| Config | The CLI's resolved settings for the current invocation — currently only the target Server URL |
| Config Source | One of the three inputs the Config is resolved from: command-line flag, environment variable, or config file |
| Server URL | The Platform deployment the CLI is configured to talk to |
| Compat Verdict | The result of comparing the local CLI's version against the server's reported `minClientVersion` and current version: `Ok`, `BehindMinClient` (hard-refuse), or `BehindCurrent` (soft-warn) |
