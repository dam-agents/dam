---
id: 081
title: Admit a blocked start by hibernating the owner's idle agents early
status: accepted
supersedes:
subsystem: budgets
tags: [hibernation, admission, capacity]
summary: The per-user budget gate may admit an over-budget start by hibernating that owner's unattended idle agents ahead of their timeout, longest-idle first, instead of refusing until the user frees room by hand.
---

# ADR-081: Admit a blocked start by hibernating the owner's idle agents early

**Date:** 2026-08-06
**Status:** Accepted
**Owner:** @JanPokorny

## Context

An over-budget start is refused with "stop a running sandbox to free room", and the room the user needs is often already sitting idle behind an unlapsed hibernation timeout — up to an hour on the default. So the user either hunts down a sandbox they had finished with and stops it manually, or waits out a timer whose only purpose was to avoid a needless cold start. Both paths spend the user's attention on bookkeeping the platform can do itself.

## Decision

The per-user budget gate may admit a blocked start by hibernating that owner's own idle agents ahead of their timeout, instead of refusing until room is freed by hand. This narrows the standing "the Budget constrains starting an agent, never running one" invariant: the sole trigger is admission pressure from the *same owner*, never a ceiling change, never another user's demand, and never cluster-level pod pressure — the Budget model does not represent the shared pool, and this decision does not give it a way in.

Reclamation is bounded by four rules:

- **Unattended only.** An agent with a session pin (chat, terminal, SSH) is never a candidate, even though the runtime's own idle probe reports an attached-but-turnless chat as idle. Agents with hibernation disabled are likewise exempt — that setting declares "always run".
- **An idle floor** (3 minutes of no activity, on top of the usual idleness checks) below which nothing is reclaimed. Beyond sparing agents a user is plausibly mid-task with, the floor is what makes the feature non-recursive: a freshly admitted agent carries fresh activity, so it cannot be the victim of the next start, and A-evicts-B-evicts-A cannot close.
- **Provably sufficient, or nothing.** The freed Sizes must cover the shortfall before any agent is hibernated; a partial reclaim that still fails to admit is not attempted, so no agent is ever killed for a start that was going to be refused regardless.
- **Longest-idle first**, one at a time, stopping as soon as the candidate fits.

Reclamation is silent. The eligibility rules confine it to agents with no attached viewer, and the outcome — hibernated somewhat sooner than its timer said — is one the agent's own settings already sanction.

Every start goes through this path, including schedule fires and channel-driven wakes, because a start the user is not watching is the case where a manual "go stop something" resolution is worst.

The gate keeps ruling **synchronously**. Reserved is summed over *desired* replicas, so scaling a victim's pair to zero frees budget the instant that write lands and the same pass can admit: reclamation adds no third outcome between admission and refusal, and the wake's fail-fast needs no notion of a reclaim in progress. What the platform does not get is the pod capacity at that instant — the victim drains on its own schedule — but Budgets have never modelled the shared pool, so a claimant briefly Pending behind a draining victim is the scheduler's business, not the gate's.

## Alternatives Considered

- **Queue the start until a victim times out naturally** — the wait is the full remaining idle window, up to an hour on the default timeout; the point is to not wait.
- **Shorten the cluster-wide idle timeout instead** — pays for a rare admission by cold-starting every user's agents all day, and the per-agent override exists precisely because the timeout is a workload judgement.
- **Evict across owners, or on cluster pod pressure** — Budgets are per-user ceilings over a pool the model does not represent; one user's demand has never been grounds to touch another's agents.
- **Prompt the user to pick a victim** — reintroduces the attention cost the decision removes, and has no answer on the scheduled and channel-driven paths where nobody is present to answer.

## Consequences

- **Easier:** The common blocked start — room held by an agent its owner is done with — resolves without user action, on paths (schedule fires, Slack and other channel wakes) where the existing resolution is a failed fire and a message no one is reading.
- **Harder:** A refused start now performs writes — an annotation stamp and a scale-down per victim — inside the read-decide-scale sequence the single reconcile worker drains, so the slowest refusal is no longer a pair of reads. Bounded by the candidate scan stopping as soon as the shortfall is covered, and by one busy-probe (3s timeout) per candidate actually considered.
- **Harder:** Hibernation's known blind spot — unreported work, which no signal sees and which hibernation kills — now lands up to a full idle window earlier than the agent's timeout advertised. The floor bounds the exposure; it does not remove it, and the escape remains what it already was: disable hibernation on agents whose real work runs off-session.
- **Committed-to:** Session pins as a load-bearing authorization signal, not just a wake-keeping one. Silence is defensible only while a pin reliably means "someone is attached"; a pin that can be dropped or missed while a viewer is present turns this into an unannounced eviction of an agent someone is using.
