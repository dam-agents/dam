# Experiments

Last verified: 2026-07-01

## Overview

An **Experiment** races several AI-driven R&D harnesses against one goal and compares what each produced. Each **Arm** is one competitor — an existing Agent (its harness is fixed as the Agent's image) plus an optional **Arm Variation**. Starting an Experiment opens one **Trial** session per Arm; inside that Trial the harness runs its own iterate-and-score loop and appends scored **Runs** to a shared **Run Ledger**.

The platform's role is deliberately narrow: it **starts Arms, captures Runs, and presents the comparison**. It never runs the optimization loop and never interprets a Score. A Score is opaque — captured, never normalized or ranked across Arms.

### The bet

There is no bespoke experiment harness. A generic Agent runs its own iterate-and-score loop and populates the ledger, driven by two things the platform already had:

- **The interface is exposed as MCP tools.** Every agent pod already runs a platform-outbound MCP server — the same one the harness uses to reach channels, skills, and schedules. Experiments adds two tools to it: one to append a scored Run, one to declare the Arm finished. MCP is the one tool-calling surface every modern harness already speaks, so putting the reporting interface there means any harness image can report back with no per-harness client and no new transport. The harness passes no Experiment or Arm id — the platform attributes the call to the caller's active Arm from its network-verified Agent identity (mechanics under [Trial flow](#trial-flow)).
- **The contract rides in the Trial prompt.** The tools exist, but nothing makes a generic harness call them unprompted. So the composed prompt carries the full reporting contract inline — an autonomous-trial directive telling the harness to run unattended to completion and to report every scored candidate, through those tools, the moment its score lands.

The contract lives in the session-scoped prompt rather than a skill for two reasons: a skill reaches only Claude-family harnesses (those that mount skill files), whereas the prompt is harness-agnostic; and a skill would leak reporting nags into every non-experiment session, whereas the prompt is scoped to the Trial. The MCP tools (how to report) plus the prompt (what to do) are what make Experiments work across any harness image without per-harness code.

## Bounded contexts

The subsystem splits across two contexts, mirroring the Connections owner/grant split ([`docs/ubiquitous-language.md`](../ubiquitous-language.md)):

- **api-server — Experiments context** owns Experiments, Arms, the Run Ledger, and Candidate storage. It composes the Trial prompt, launches Trials, attributes and records inbound Runs, serves Candidate downloads, and enforces the completion and liveness rules. Owner-scoped end to end — like a Connection, an Experiment belongs to a user and references many Agents through its Arms.
- **agent-runtime side** runs the Trial. A new runtime-channel event handler opens the Trial session against the harness and submits the composed prompt; from then on the harness drives itself and reports back over MCP.

Experiments is assembled from existing rails rather than new plumbing:

- **Ownership** copies the Connections owner + grant-to-many-Agents model.
- **Launch** reuses the runtime channel's trigger/wake primitive — the same durable outbox delivery and agent-poke the scheduler uses ([connections](connections.md#event), [agent-lifecycle](agent-lifecycle.md)).
- **Reporting** rides the in-pod outbound MCP surface the agent already uses for channels and skills.
- **The reporting contract** travels in the Trial prompt, not in code shipped to the harness.

## Resources

Described in [ubiquitous language](../ubiquitous-language.md#experiments-bounded-context--proposed-mvp-design); field-level shapes live in the [Experiments contract types](../../packages/api-server-api/src/modules/experiments/).

- **Experiment** — owner-scoped, holds the shared prompt (the common instruction every Arm receives), a lifecycle status, and the Run Ledger. Peer to the Agent.
- **Arm** — one competitor: a reference to one owned Agent plus its Arm Variation. Keyed per `(Experiment, Agent)`, so the same Agent cannot be two Arms of one Experiment, but the same harness image can back many Agents raced against each other.
- **Arm Variation** — optional free text appended verbatim to the shared prompt at Trial launch, under its own header. The single declared variable that distinguishes one Arm from another. Opaque to the platform, which stores and forwards it but never parses it; the shared prompt is the un-overridable control and the variation only adds.
- **Trial** — the single Session an Arm's Agent opens when the Experiment starts. The harness runs its loop here. It owns the transcript and session-level telemetry, which are therefore Arm-level, not Run-level.
- **Run** — one entry the harness appends to the Run Ledger per loop iteration: a Score plus a Candidate. Numbered monotonically within its Arm.
- **Candidate** — the artifact a Run produced, retrievable as a download. Opaque to the platform.
- **Score** — the number a harness reports for a Run. Higher-is-better by convention; captured, never normalized across Arms.
- **Run Ledger** — the append-only record of every Run across an Experiment's Arms. The one genuinely new persistence primitive.

## Trial flow

```mermaid
sequenceDiagram
  participant U as user (UI)
  participant API as api-server<br/>(Experiments)
  participant RT as agent-runtime
  participant H as harness

  U->>API: start Experiment
  API->>API: mark Arms running, compose Trial prompt per Arm
  loop per Arm
    API->>RT: experiment-trigger event (runtime channel) + wake
    RT->>H: open Trial session, submit prompt
  end
  loop each scored candidate
    H->>API: record_run (MCP): score + candidate file
    API->>API: store Candidate blob, append Run to ledger
  end
  H->>API: finish_arm (MCP)
  API->>API: Arm completed; Experiment completed once all Arms terminal
```

**Launch.** Start marks each Arm running and composes its Trial prompt — the shared prompt, then the Arm Variation, then the autonomous-trial directive. The prompt is delivered as an `experiment-trigger` event on the runtime channel, which wakes a hibernated Agent and opens the Trial session ([connections](connections.md#event)). A Trial that fails to launch fails its Arm immediately rather than waiting for the liveness sweep — an Arm that never started can never report or finish.

**Ingestion and attribution.** The harness reports through two outbound MCP tools — one to append a scored Run, one to declare the Arm finished. Neither takes an Experiment or Arm id: the platform resolves the caller's active Arm from the Agent's network-verified identity (the mesh waypoint guarantees the MCP principal matches the pod), so a harness cannot report against an Experiment it isn't running. Both are rejected once the calling Arm is no longer running — the ledger is closed after Stop or completion. The completion tool is success-only: a harness that gives up simply stops and is caught by the liveness sweep.

## Candidate storage

A Candidate is stored inline as a capped blob in Postgres, written and read by the api-server — not on a per-Agent PVC and not in object storage (agents are egress-locked to their gateway, so S3 is unreachable). Living in Postgres is what makes a Candidate **downloadable while the producing Agent is hibernated**: Postgres is independent of agent pods and the api-server, its sole reader and writer, is always running. On a Run, the reporting path reads the candidate file from the Agent's workspace over the harness file API and hands the bytes to the api-server, which stores the blob and points the Run at it. Downloads are owner-scoped — the Run is resolved through the owner's Experiment first, so a non-owned Experiment reads back as not-found and the opaque storage key is never trusted from the client. Substrate details are owned by [persistence](persistence.md).

## Completion and liveness

Per-Arm status is the source of truth for completion. An Arm moves `pending → running` at launch, then to one terminal state: **completed** (the harness declared it finished), **failed** (the Inactivity Deadline tripped, or the Trial failed to launch), or **stopped** (the user Stopped the Experiment while the Arm was still running). An **Experiment becomes completed once every Arm is terminal**, regardless of the mix — the platform reports the comparison, it never judges the whole Experiment failed, so there is no Experiment-level `failed`. Stop is the distinct user-driven terminal path: it moves any still-running Arm to `stopped`.

The **Inactivity Deadline** is the liveness guarantee that lets a started Experiment always reach a terminal state. A background sweep marks a running Arm failed if it records no Run and never declares itself finished within a configured window; the clock resets on each Run. Without it, a harness that crashes, forgets to finish, or hibernates mid-loop would strand its Arm running forever — the one-shot Trial prompt is never re-issued, so a hibernated mid-loop Arm goes quiet permanently. The sweep is safe to run on every api-server replica: each reap is an atomic conditional transition, so a contention race just no-ops on the already-terminal row, and a randomized start offset keeps replicas from scanning in lockstep.

## Where the code lives

- Contract (resources, service interface, MCP tool inputs): [`packages/api-server-api/src/modules/experiments/`](../../packages/api-server-api/src/modules/experiments/)
- Implementation (service, repository, Trial prompt, launcher, liveness sweep, Candidate serving): [`packages/api-server/src/modules/experiments/`](../../packages/api-server/src/modules/experiments/)
- Trial-side event handler: [`packages/agent-runtime/src/modules/runtime-channel/`](../../packages/agent-runtime/src/modules/runtime-channel/)
- UI destination: [`packages/ui/src/modules/experiments/`](../../packages/ui/src/modules/experiments/)
