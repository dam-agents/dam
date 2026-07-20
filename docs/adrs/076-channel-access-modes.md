---
id: 076
title: "Per-channel access modes — shared and person-scoped"
status: accepted
subsystem: channels
summary: Each channel binding picks its access mode at bind time — shared (place-scoped, Agent credentials, open speaker set) or person-scoped (identity linking, allow-list, per-turn forks).
---

# ADR-076: Per-Channel Access Modes — Shared and Person-Scoped

**Date:** 2026-07-17
**Status:** Accepted
**Owner:** @pilartomas

## Context

The two channel adapters carry opposite multi-user models. Slack is
person-scoped: every user links a platform identity, an owner-curated
allow-list gates who may drive, and a non-owner reply runs in a
per-turn fork under the replier's own credentials. Telegram is
place-scoped: the owner authorizes a conversation once, and every
member drives the Agent on the main pod under the Agent's credentials.

The person-scoped path carries standing costs — login friction for
every Slack user, a per-turn pod-pair spin-up with a two-minute
provisioning window, and three known defects (unbounded concurrent
forks, a same-thread session race on the shared workspace volume,
fork state lost on api-server restart) — while Claude Tag validated
the place-scoped model at scale.

## Decision

Each channel chooses its access mode at bind time: the Agent owner
performing the binding picks, via a toggle, either **shared ("system
Agent") mode** — place-scoped: anyone the messenger admits drives the
Agent, every turn on the main pod under the Agent's own credentials,
attributed by messenger identity — or **person-scoped mode** — today's
Slack model kept as is: identity linking, the allowed-users gate, and
per-turn foreign-replier forks.

- *Proposed default:* person-scoped. Lending the Agent's authority to
  a whole room is the wider grant, so it is the explicit opt-in.
- *Proposed switching:* changing mode means unbind and rebind;
  sessions minted under one mode are never resumed under the other.
- The toggle exists where both models are implemented — Slack today.
  Telegram stays shared-only; this decision does not build per-user
  identity for it. New adapters must implement shared mode;
  person-scoped mode is optional.
- In shared mode, binding is the act of access control: the consent
  copy states that everyone in the place will act with the Agent's
  credentials, and membership is governed by the messenger.
  Credential selection is per-Agent, never per-speaker.
- In both modes, the owner's human-in-the-loop approval rules and
  egress rules gate every turn.

## Alternatives Considered

- **Full place-scoping on every messenger** — deletes the fork
  subsystem and its defects, but removes the per-speaker credential
  boundary everywhere.
- **Status quo** — the model stays an accident of the adapter; Slack
  channels have no path to zero-onboarding access.
- **Drop forks, keep identity linking** — keeps the login friction
  while giving up the credential boundary that justified it.
- **Per-turn credential injection at the main gateway** — keeps all
  per-user credential plumbing and adds turn-serialization concerns
  on a single gateway.
- **Dedicated service-account credentials per channel** — the full
  Claude Tag shape; complementary hardening for shared mode that can
  layer on later.

## Consequences

- **Easier:** Channels that opt into shared mode get zero onboarding
  and single-path turns — the structural prerequisite for
  un-mentioned follow-ups, shared thread sessions, and ambient
  replies, none of which can run under person-scoping because an
  unlinked member's message has no identity to run under. Telegram's
  behavior becomes a documented mode instead of an adapter quirk.
- **Harder:** Both relay paths are permanent. The fork subsystem's
  three defects become fix-work rather than delete-work, and every
  future channel capability must either serve both modes or declare
  itself shared-mode-only. The bind flow grows mode UX and consent
  copy. On shared channels the per-speaker credential boundary and
  per-user usage accounting are given up; excluding one member means
  messenger-side removal or unbinding.
- **Committed-to:** The bind-time toggle is the contract with owners.
  Retiring either mode later is a new decision with a migration for
  every bound channel, not a cleanup.
