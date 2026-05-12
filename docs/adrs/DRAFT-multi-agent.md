# DRAFT: Multi-agent collaboration — instances calling instances

**Date:** 2026-05-12
**Status:** Proposed
**Owner:** @tomkis

## Context

As agent use cases mature, users want multiple specialized agents collaborating — e.g., a cheap Pi agent acting as primary liaison that escalates to Claude Code only when task complexity warrants it; or a "software factory" where an orchestrator agent dispatches work to specialized workers and consumes their results.

[OpenClaw](https://github.com/openclaw/openclaw) demonstrates this with a multi-agent configuration file: all agents share one mutable system environment, permissions are enforced partly via prompts. Workable for personal use, unsuitable for enterprise: mutable shared state, prompt-based security boundaries, no enforceable isolation.

UXR signal from the Pi launch: cost is the dominant blocker for autonomous scheduling. A multi-agent model that *enables* cost-control patterns (cheap-by-default, escalate on demand) is therefore as much a product feature as it is an architecture choice.

Prior decisions this builds on:

- [ADR-001](001-ephemeral-containers.md) — per-instance ephemeral container with own workspace volume.
- [ADR-005](005-credential-gateway.md) — per-instance credential scoping.
- [ADR-007](007-acp-relay.md) — ACP relay as the per-instance control surface.
- [ADR-012](012-runtime-lifetime.md) — long-lived instance pods.
- [ADR-015](015-multi-user-auth.md) — multi-user auth.

## Decision

**Each agent is a separate long-lived instance. Agents collaborate by calling each other through a typed ACP RPC. Per-pair scratch volumes carry bulky artifacts.**

This is **delegation, not hierarchy** — agents are tools other agents may invoke. No parent owns child lifecycle; no recursive ownership tree.

### 1. The edge: `allowedCallees` on the caller

The caller's instance spec declares the set of callable callees:

```yaml
# Alice's instance spec
spec:
  allowedCallees:
    - bob-id
```

A bare ID list. Caller-side declaration. Creating the edge:

- Materializes a Kubernetes `Service` for Bob (`bob-id.<ns>.svc.cluster.local`) — Alice resolves Bob via cluster DNS.
- Materializes a per-pair `NetworkPolicy` allowing Alice's pod to reach Bob's pod on the ACP port.
- Provisions a per-pair `PersistentVolumeClaim` owned by Alice; mounted into both Alice's and Bob's pods.

Removing the edge tears all three down.

### 2. Scope: single-user in v1

V1 assumes a single owning user across the pair. Caller-declares is sufficient — there is no consent boundary to negotiate.

V2 (multi-user, see [ADR-015](015-multi-user-auth.md)) **adds callee-side declaration**: Bob's spec must also list Alice. The edge is materialized only when both sides agree. Caller-declares → mutual-consent is additive; no v1 → v2 schema break.

### 3. The call protocol: `bob.invoke()`

Bob's agent-runtime exposes a single opaque method over ACP:

```
bob.invoke(prompt: string, sessionId?: string) -> response
```

- **Opaque shape.** No typed methods, no published schema. Bob is exposed in Alice's tool list as one tool: "send a prompt to Bob, get a response."
- **Alice-controlled session.** `sessionId` is opaque to Alice; reusing it continues a stateful thread with Bob, omitting it starts a fresh one.
- **Bob sees the call as a user message.** No caller metadata is surfaced to Bob's LLM. From Bob's prompt's perspective, an agent caller is indistinguishable from a human.
- **Single in-flight per Bob.** Concurrent callers are transparently FIFO-queued at Bob's agent-runtime. Charlie's `invoke` blocks until Bob is free.

### 4. Artifacts: per-pair PVC

Bulky data does not travel in the ACP payload. Each `allowedCallees` edge gets an auto-provisioned PVC:

- **Owned by Alice.** Lives in Alice's namespace, counted against Alice's quota, GC'd with Alice's instance or the edge.
- **Mounted in both pods.** Symmetric read-write — either side may read or write.
- **Path layout is platform-managed.** No user-specified globs. Controller decides mount paths.

The intended usage pattern: Alice writes a job spec to the PVC, calls `bob.invoke("process the spec in /work")`, Bob reads the spec, writes large outputs back to the PVC, returns a short summary via ACP. The ACP reply contains references (paths) to bulk artifacts, not the bytes.

### 5. Streaming and lifetime

- **No call cap.** The ACP WebSocket is held open for the duration of `bob.invoke()`. Failure of the WS = failure of the call. No resume mechanism in v1.
- **Final result only to Alice's LLM.** Bob's progress stream is visible to the operator dashboard (the human watching) but is *not* fed back into Alice's LLM context. Alice's tool call resolves with Bob's final message.

### 6. Cycles forbidden — DAG enforced at admission

A Kubernetes admission webhook on the instance spec rejects an `allowedCallees` write that would close a cycle in the directed graph. Users see immediate "would create cycle" errors at edit time rather than silent reconcile-loop failures.

V1 explicitly forbids cycles. If peer iteration (A↔B) becomes a needed pattern, revisit then with a call-tree budget (see Deferred).

## Alternatives Considered

**Hierarchy as a first-class platform concept.** Parent agent owns child lifecycle, schedules it, persists across child runs. *Rejected:* the use cases on the table (Pi-escalates-to-Claude, software factory) are served by delegation. Hierarchy doubles the platform surface for no demonstrated benefit. Revisit only when a use case demonstrably cannot be expressed as a DAG of delegations.

**Continuous shared mounts ("shared Google Drive folder").** Mount a folder from Alice into Bob continuously; communication is implicit via filesystem events. *Rejected after grilling:* conflates "Bob can read Alice's data" with "Alice is asking Bob to do work." Per-pair PVC behind a call boundary is closer to function-call semantics — the act of calling is the act of sharing.

**Spec on the callee (`allowedCallers` on Bob).** Bob declares his attack surface. *Rejected for v1:* in single-user, the caller-declared model is strictly less config (one side touches Alice's spec to grant Alice access). For multi-user v2 we will require both — but that's additive on top of v1.

**Typed methods or MCP-style schema-publish by Bob.** *Rejected for v1:* opaque `invoke()` is the smallest surface that works. Add typed methods only when a use case shows up that an opaque prompt cannot express.

**Per-edge budget, per-instance budget, per-call-tree budget.** *Deferred:* v1 assumes single-user, single-payer; the user can monitor their own bill. Budgets become required when multi-user lands, not before.

**OpenClaw-style config-file multi-agent.** Single config defining all agents, shared environment, prompt-based permissions. *Rejected:* prompt-based security is not enforceable. Platform's value is platform-level isolation.

## Consequences

- **Per-instance credential scoping is foundational.** Each pod, each PVC, each credential set scoped to one instance. ([ADR-005](005-credential-gateway.md).)
- **Controller adds three resources per edge:** Service, NetworkPolicy, PVC. All keyed on `(caller, callee)` pairs. GC follows the caller's instance.
- **Admission webhook is new infrastructure.** Cycle check requires the controller to read the full edge graph at admission time.
- **No protocol invention.** `bob.invoke()` is a new ACP method but rides existing relay infra ([ADR-007](007-acp-relay.md)).
- **Cost amplification risk is unmitigated in v1.** A misbehaving Alice can spam `invoke` and burn Bob's tokens. Mitigated by single-user assumption only.
- **Aligns with the "agents-as-employees" mental model.** Alice has a Rolodex of colleagues she may call; each call leaves a paper trail (PVC + ACP log); colleagues have their own offices (instances) the user explicitly hired.

## Open Questions

- Caller identity in `allowedCallees`: instance ID, k8s ServiceAccount, or template name?
- ACP call auth: NetworkPolicy alone enough, or add token check?
- PVC mount paths on each side; read-write modes?
- sessionId TTL; cleanup policy on Bob's side?
- Bob restart mid-call: fail or reconnect?
- PVC GC: on edge removal, on Alice delete, on Bob delete — who cleans?
- v2 cycle check across user-owned subgraphs: who validates?
- Operator dashboard for Bob's stream: standalone view, or merged with caller's session?
- Tool list shape for Alice's LLM: one `bob.invoke` tool, or split `openSession`/`invoke`/`closeSession`?
- Reusable Bob templates vs hand-rolled per pair?

## Deferred to v2+

- **Multi-user mutual consent** (`allowedCallers` on callee).
- **Per-edge / per-call-tree budgets** when multi-user lands.
- **Call resume / attach** for genuinely long-running calls.
- **LLM-visible progress stream** for real-time co-ordination.
- **Cycles with bounded depth** when peer iteration is needed.
- **Typed Bob methods / MCP-style schemas** when an opaque prompt is insufficient.
