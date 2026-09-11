# Persistence

Last verified: 2026-09-11

## Overview

Platform persists state on three durable substrates, split cleanly between the platform and the agent. Two of the three are **shared by every node** and run in the cluster beside the install rather than on any node; the third is the agent's own directory, which is deliberately node-local — see [platform-topology](platform-topology.md):

**Platform-owned** (the agent never touches these):

- **Postgres** — application state the api-server owns end-to-end. Sole writer: api-server. Holds anything that has to be queryable when no sandbox is running (the agent records themselves, channel bindings, identity links, allow-listed users, schedules) plus any other api-server-only domain resource. Session metadata is *not* here — it is agent-owned, save for the one dimension the spend read path cannot lose to hibernation or agent deletion (see the session directory below). The bundled instance runs under three login roles — one NOSUPERUSER owner per service (`platform_apiserver`, `platform_keycloak`) plus the bootstrap superuser `platform`, kept as a separate statement-logged role for DBA work — so the api-server's connection credential cannot reach Keycloak's database or escalate. Admin sessions carry a per-role `log_statement` default that puts every statement they issue into the journal; the server-wide default logs DDL only, so routine application DML stays out of the audit trail while every role and grant change is captured whoever issues it. A fourth role, `usage_readers`, carries no credential and cannot log in: it is the group an operator grants membership in to give a read-only login access to the usage source passthrough views, owned by [usage-tracking](usage-tracking.md#source-passthrough-views).
- **Object store** — bulk binary blobs behind an S3-compatible API; consumers: artifact-library content and the published read-only snapshots of shared knowledge bases. The api-server is its sole standing authority: it holds the only credentials and mints short-lived, single-object links that let an agent upload or download (through its paired gateway) or a browser download directly, after ownership checks — each link signed for the authority its audience dials, since it is only valid on that one — an agent has no access to the store beyond a link the platform issued. The cluster runs a single-node SeaweedFS by default so a fresh install works without an external account; operators point it at their own S3-compatible endpoint instead. An install with no object store cannot store artifact content — the feature fails closed.
The agent record lives here too, carrying user intent as `spec` and observed state as `status` in one row. The API surface writes only the former, the supervisor only the latter.

**Agent-owned**:

- **The per-agent directory** — the agent's home, holding its work tree, bind-mounted into the sandbox. The agent process reads and writes here freely; it has no access to Postgres or to the record that describes it. Persists across hibernation; removed when the Agent is deleted. It lives on the disk of the node holding the agent — which is what makes it fast enough to build in — and moves with the agent when placement does; the agent record names the node whose copy is current, so there is exactly one place to ask and no question of which copy to trust.

Alongside the durable substrates, the install runs one **Redis** in the cluster that no api-server can boot without. It holds only coordination and ephemeral state (job queues, presence keys, handoff flows, the cross-node change bus, and the pending sign-ins, share sessions and render grants for [restricted artifacts](artifact-library.md)). Losing this state signs restricted viewers out, interrupts pending sign-ins and invalidates outstanding render grants; viewers must sign in again or reload the share page. No artifact content or viewer allowlist is lost; Postgres stays the source of truth for anything durable, and the scheduled sweeps re-assert their registrations so a dataset loss cannot silently stop them ([platform-topology](platform-topology.md)).

**Choosing where state goes.** Durable platform state goes in Postgres; there is no second store to weigh it against. What the supervisor reconciles into running infrastructure is the agent record's `spec`, and what it observes about the result is that record's `status` — one row, two writers, one write path each. Templates are read-only files on the node because nothing writes them at runtime; schedules are rows because the api-server owns them end to end.

The agent's only durable surface is its directory; everything the platform knows *about* the agent is written to Postgres by the api-server or the supervisor, never by the agent itself.

The optional agent-telemetry backend adds a fourth durable substrate, outside this split — see [observability](observability.md). It is operator-managed and self-contained: neither the agent nor the supervisor touches it, and it exists only when that subsystem is enabled.

## Diagram

```mermaid
flowchart LR
  api-server[api-server]
  supervisor[sandbox supervisor]
  agent-runtime[sandbox: agent-runtime]

  objectstore[(Object store<br/>S3-compatible)]

  subgraph postgres[(Postgres)]
    rec-spec[agent record<br/>spec]
    rec-status[agent record<br/>status]
    rec-anno[agent record<br/>annotations]
    rec-place[agent record<br/>placement]
    other[everything else<br/>the api-server owns]
  end

  dir[(Per-agent directory<br/>the agent's home)]

  api-server -->|write| other
  api-server -->|read/write| objectstore
  api-server -->|write| rec-spec
  api-server -->|read| rec-status
  api-server -->|annotate| rec-anno

  supervisor -->|write| rec-status
  supervisor -->|read| rec-spec
  supervisor -->|read| rec-anno
  supervisor -->|read: is this mine| rec-place
  scheduler[scheduler: on the node holding the lock] -->|assign / release| rec-place

  agent-runtime -->|read/write| dir
```

## Substrates

### Postgres

Postgres carries application state the api-server owns end-to-end — anything that has to be queryable when no sandbox is running.

- **channel routing** — bindings between external chat surfaces and the Agent/session they map to. Owned by [channels](channels.md). A Slack binding is one row per bound conversation, its identity the (Agent, conversation) pair — the conversation id being a channel, group DM or 1:1 DM, undifferentiated — so an Agent cannot connect to one conversation twice, while several Agents may share it. A second, narrower index admits at most one row per conversation marked default — at most, never exactly one, so having no default is a state the schema permits and the routing handles. Each binding carries its own ambient and default flags (absent = off). `telegram_conversations` records the conversation→Agent binding for Telegram, plus the binding owner's sub: different shapes by design, since Slack has a workspace and Telegram does not. `identity_links` maps a messenger user to a Keycloak sub, keyed by provider, so it serves any future workspace channel.
- **identity and auth** — links between channel-side identities and platform users, the auth allow-list, and API keys for headless CLI use. Owned by [security-and-credentials](security-and-credentials.md).
- **skills catalog** — connected sources, per-Agent install records, publish history, and the per-user named skill selections a user carries between agents. Owned by [skills](skills.md).
- **activity log + agent mirror** — append-only event log (`activity_events`), per-sub role flags (`actor_roles`), and the pseudonymized agent ownership mirror (`agents`). Pseudonymized `actor_sub` and `owner_sub` columns at the write boundary. Owned by [usage-tracking](usage-tracking.md).
- **session directory** — the kind of each Session (`agent_sessions`), reported by the agent that owns it. A deliberate copy of agent-owned state, kept only so spend can still be attributed to how the work was started once the agent hibernates or is deleted; it is not a Session store and no Session is read from it. Owned by [metrics](metrics.md#session-directory).
- **schedules** — RRULE, quiet hours, task payload, session mode, and firing bookkeeping (`schedules`). The api-server's schedule loop fires them. Owned by [agent-lifecycle](agent-lifecycle.md).
- **public agent profiles** — a projection of each channel-bound Agent's name and owner (`agent_public_profiles`), serving the one unauthenticated read surface. What is unusual is _why_ it duplicates state the agent record already holds: the projection is narrow by construction, so an anonymous read cannot reach anything but a name and an owner, whatever the record beside it grows to carry. Owned by [public-agent-page](public-agent-page.md).
- **credential material** — the credential bytes the gateway injects, one row per secret path with its owner and purpose, plus a small set of install-wide secrets of which the install CA's private key is one. Held here rather than on a node's disk for a plain reason: any node may be asked to run any agent, so a credential on one node's disk is a credential the install cannot use. Owned by [security-and-credentials](security-and-credentials.md).
- **nodes** — one row per node: its address, its capacity, whether it is accepting work, and its heartbeat. Liveness is computed from the heartbeat on read rather than stored, so each row has one writer and nothing arbitrates. Owned by [platform-topology](platform-topology.md).
- **knowledge-base shares** — one row per shared knowledge base (`kb_shares`): the durable share secret, owner-controlled public name, the published-snapshot pointer and stats, and the publish/auto-refresh lifecycle bookkeeping. The snapshot bytes live in the object store; this row is the queryable index and access record, and answering a consumer's request must not require the owning agent to be running. Owned by [knowledge-bases](knowledge-bases.md#sharing).

Two of those rows carry an owner's Keycloak sub, and they carry it **differently on purpose**: the usage mirror hashes it, because pseudonymized identifiers are that subsystem's whole premise, while the public agent profile stores the real sub, as channel bindings already do. The difference is the requirement, not an oversight — a public page names its Agent's owner, and a hash cannot be resolved back to a person. Neither table can stand in for the other, and the pseudonymized one must not be extended to serve the page.

The api-server is the sole writer for all of it, the supervisor's status writes included. The authoritative schema and migrations live in [`packages/db/`](../../packages/db/): migrations run automatically on api-server startup, serialized on a Postgres advisory lock — table/index/enum changes generated from the schema, the reporting views hand-written — with the original history squashed to a baseline that fresh installs run and existing deployments skip, and a no-database guard asserting every schema change was generated (workflow in [`packages/db/README.md`](../../packages/db/README.md)). One non-schema step follows the migrations in the same startup sequence: a privilege reconcile for the usage source passthrough views, owned by [usage-tracking](usage-tracking.md#source-passthrough-views).

### Object store

The object store carries bulk binary blobs that would be wrong as database rows — data whose size, not queryability, is the point. Its consumers are artifact-library content ([artifact-library](artifact-library.md)) and the published read-only snapshots of shared knowledge bases ([knowledge-bases](knowledge-bases.md#sharing)); it is also the durable-bulk-storage foundation intended for future features like storage backups and agent duplication.

Ownership is api-server-centric: it holds the only standing credentials, and bulk bytes move **directly** between producer/consumer and the store under platform-minted authorization — the api-server issues short-lived links scoped to a single object and operation, each signed for the authority its audience dials and valid on no other (upload links to agents after attributing the caller, download links to an agent through its gateway or to a browser directly, after owner checks), and the store rejects anything else. An agent's traffic still exits only through its paired gateway; what changes with the store present is that the gateway forwards store-bound requests without a per-request human decision, the link itself being the authorization ([security-and-credentials](security-and-credentials.md)). Blobs are addressed by an opaque reference held in Postgres; the store itself holds no queryable state.

The store is any S3-compatible endpoint, chosen at deploy time in the node configuration: the node configuration bundles a single-node SeaweedFS by default (dev and local clusters work with no external account; Apache-2.0, so bundling carries no copyleft obligations), or the operator points the platform at an external store — a cloud bucket or an on-prem installation. The api-server provisions its bucket at startup when missing and fails boot fast when the store is unreachable. An install with no object store fails closed: bulk-blob features are unavailable until one is configured.

### The agent record

One Postgres row per Agent, carrying both intent and observation with a
strict single-writer split on each half:

| Column | Holds | Written by |
|---|---|---|
| `spec` | Agent definition: image, env, secret refs, granted secret and connection IDs | api-server |
| `status` | Observed state: readiness, hibernation, the sandbox's address and restart count, the reconcile error if any | supervisor |
| `annotations` | Activity stamps and the flags derived state is computed from — last activity, active session, experiment active, stop requested | api-server |
| placement | The node the Agent is assigned to, and the node whose disk holds its workspace | scheduler; the holding node's supervisor for the second |

The split is held by having exactly one function that writes observed state:
nothing else may touch `status`, and the supervisor writes nothing else.
Placement is neither intent nor observation, which is why it is beside them and
not inside either: a user does not ask for a node, and a node does not discover
that an agent is its own.

There is no stored desired state. Wake is a one-off activity stamp, the
supervisor hibernates on idleness, and running-vs-hibernated is recorded as
observed status; see [agent-lifecycle](agent-lifecycle.md).

**Templates** are read-only YAML files laid down on every node and loaded at
boot — nothing writes them at runtime. **Schedules** are Postgres
rows the api-server owns end to end.

### The per-agent directory

Every agent has one directory on the node holding it, and that directory *is*
the agent's home — its work tree is a directory inside it, exactly as the agent
sees it, rather than a sibling that only looks nested from within the sandbox.
One directory is what makes the lifetime answerable in one sentence: everything
under it persists, everything outside it dies with the sandbox, and a transfer
between nodes cannot carry half of it. The gateway's rendered configuration and
credentials sit outside, rebuilt on every reconcile rather than persisted.

A home directory starts empty and shadows whatever the image bakes at that
path, so the image's boot seeds it on first start from the staged workspace: a
no-clobber copy behind a sentinel file, run once, so image content lands
exactly once and files the user later edits are never overwritten by a
restarted or upgraded image. The seed lives in the image's own boot sequence —
the container entrypoint — with no separate init step. Image-shipped skills
are the one carve-out from once-per-directory: they are seeded, updated and
retired per skill by [image-skill reconciliation](agent-skills.md#image-skill-lifecycle),
so a skill added to an image reaches existing directories too.

The default Claude Code template persists the workspace and `$HOME`. Together
these hold:

- the **workspace** itself — git checkouts, tool caches (`node_modules`, `.venv`, mise), and any artifacts the agent has produced.
- **`$HOME`** — agent memory, skills, MCP server caches, and the harness's on-disk session store. The session store is what a cold re-attach reads after a sandbox restart, whichever verb the harness advertises for it ([agent-lifecycle](agent-lifecycle.md#session-inside-the-sandbox)). The agent-runtime's `.platform/` directory lives here too, holding the **session-metadata state file** — the platform's source of truth for per-session mode, type, `scheduleId`, `threadTs`, `createdAt`, the time of the session's last genuine message, and run accounting for scheduled fires (how many the session has served and their summed duration, timed only for machine-driven turns so a human reply never counts), surfaced over ACP `_meta.platform` and (for mode and type alone) mirrored into the session directory above — the totals are durable, but a run's start stamp is not: it cannot outlive the process that set it, so the totals under-count a fire a restart interrupted — alongside the trigger-binding and runtime-channel state files. The same directory holds the **undelivered-prompts document**: the whole content of user prompts that never reached the harness (inline images capped, file attachments by name), written only when a prompt is recorded, sent again, or deleted — never on a routine turn — and deliberately separate from session metadata so a corrupt metadata write cannot take user text with it. A record outlives session teardown and sandbox restarts; it goes when the user resends or deletes it, with its Session, or — the document is byte-capped — when another session's write needs the room, evicting whole sessions oldest-first ([agent-lifecycle](agent-lifecycle.md) owns the delivery contract). A third document, **active-turns**, marks each session while a turn runs and clears it on every turn end agent-runtime observes; a marker still present at the next boot names a turn whose end it never saw — the process was SIGKILLed (an OOM group-kill) mid-turn — which agent-lifecycle's recovery consumes to resume that session automatically, its own document again so a corrupt write cannot take run accounting or user text with it. The directory also holds the **run-results document**: for each `cli_run` Session, the newest finished turn's outcome — prompt identity, stop reason, accumulated assistant text (size-capped per turn, marked when cut) — written at turn end so a detached headless caller can read the result after the in-memory session log is reaped. One record per Session, newest turn wins; it goes with its Session or, under a byte cap of its own with the same evict-oldest rule, when another write needs the room ([cli](cli.md#headless-runs) owns the concept).
- **`.import-staging-*/`** — transient extraction directories used by the bundled file-import path before entries are merged into `<homeDir>/work`. Orphaned staging dirs from crashed imports are reclaimed by an agent-runtime boot sweeper; see [platform-topology](platform-topology.md).

The directory survives hibernation — stopping the sandbox touches nothing
under it. The supervisor removes it when the Agent is deleted, which is
intentional rather than incidental: deletion is a decision, not a fault.

What does **not** survive hibernation: anything written to the sandbox's
ephemeral filesystem outside the persisted mounts — OS-level changes,
packages installed at runtime, files in `/tmp`. `$HOME/.cache` is deliberately
in this category: the base-image entrypoint redirects it to node-local scratch
so churn-heavy tool caches don't load the persisted directory. The redirect is
best-effort — a swap that fails is a performance regression rather than a boot
failure, leaving that agent's cache where it does survive. Tools and
dependencies the agent relies on must be baked into the image at build time.

## Lifetime

| Event | Postgres | Object store | Agent record (spec/status) | Per-agent directory |
|---|---|---|---|---|
| Sandbox restart | survives | survives | survives | survives |
| Hibernate | survives | survives | survives | survives |
| Wake | survives | survives | survives | survives |
| api-server restart | survives | survives | survives | survives |
| Node reboot | survives | survives | survives | survives (the node comes back with its disk) |
| Agent moves to another node | survives | survives | survives | transferred to the new node before the sandbox starts |
| Node lost | survives | survives | survives | intact but unreachable — the Agent is unavailable until that node returns |
| Agent delete | Agent-scoped rows removed or closed out (below) | artifacts survive (owned by the library, not the Agent); the Agent's knowledge-base share snapshots are purged | row removed | directory removed by the supervisor |
| Schedule delete | schedule row removed | n/a | n/a | n/a |

**Agent-scoped rows follow the Agent.** No Postgres table references an Agent by foreign key, so the database does not cascade on its own and the api-server owns the cleanup. An API delete runs one cleanup per record kind from a single declared list: schedules (their queued fires cancelled), runtime-delivery outbox and events, egress rules, pending approvals, connection grants, environment variables, API-key scopes, the registry credential, channel bindings, skills, knowledge-base shares (revoked, snapshots purged), the usage mirror (marked deleted) and the public profile (retired); running Experiments and Invocations the Agent drove are failed and its draft Experiments removed. A periodic orphan sweep backstops that list: it diffs every kind's agent ids against the live agent records and re-runs every cleanup for each id that no longer resolves. The deletion event carries no cleanup; both paths emit it only to notify runtime reactions — the UI hint and the Slack worker registration. The sweep names the owner on it only when a surviving channel, schedule or share row still records one; the UI hint is the one consumer that needs it, and the agent watch already delivers that hint when the record disappears. It re-reads the candidate's record right before reaping, so a row written after its Agent existed is never reaped from a live one. The sweep is what makes a deletion the api-server crashed halfway through end in the same state as one that completed. Kept on purpose: the usage row (soft-deleted, its runtime and config snapshots cleared so a later Agent under the same name starts clean), library artifacts, the activity log, finished Experiments, and the session directory (kept so spend stays attributable). Sessions are agent-owned files in the per-agent directory, not Postgres rows — they follow that column, not this one.

An Agent created on a private custom image carries an agent-scoped registry credential that follows the Agent itself: the api-server writes it at create and removes it on delete (a delete-time cleanup hook, with an orphan sweep as backstop). This is the opposite of the owner-scoped credentials the gateway injects for egress, which are reusable across an owner's Agents and outlive any single one. The mechanism and trust boundary live on [security-and-credentials](security-and-credentials.md#image-pull-credentials).

## Security boundary

The per-agent directory is a **shared mutable surface across every session, trigger, and channel-driven prompt that runs on the same Agent.** Anything written into the workspace by one turn — model output saved to disk, tool output, files fetched from upstream, and the documents people attach in a bound channel — is plain context for the next turn. That last writer is not the Agent's owner: a channel binding admits whoever the messenger admits, so a passer-by can put bytes on the disk a later session reads. Treat workspace contents as adversarial input. A scheduled job can plant a file that prompt-injects a later user-driven session; a Slack-driven prompt can leak its instructions through residue left on disk.

The platform does not sandbox writes within the workspace. Mitigations live elsewhere: the sandbox's network topology restricts which upstreams the agent can reach (it can only dial its paired gateway, never an upstream directly), and the gateway gates credentialed egress. The threat model and credential isolation are detailed on [security-and-credentials](security-and-credentials.md).
