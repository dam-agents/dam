# ADR-NNN: Place-Scoped Channel Access

**Date:** 2026-07-14
**Status:** Proposed
**Owner:** @pilartomas

## Context

The two channel adapters carry opposite multi-user models. Slack is
person-scoped: every user must link a platform identity before the bot
answers, an owner-curated allow-list gates who may drive, and a reply
from anyone but the Agent owner spins up a per-turn fork — a paired
pod set running under the replier's own credentials. Telegram is
place-scoped: the owner authorizes a conversation once, and every
member of that conversation drives the Agent on the main pod under the
Agent's credentials, with no per-user identity anywhere.

The person-scoped half carries standing costs: login friction for every
Slack user, a per-turn pod-pair spin-up with a two-minute provisioning
window, and known defects — concurrent forks are unbounded, two quick
replies race on the same session file over the shared workspace volume,
and in-flight fork state is lost on api-server restart. Meanwhile
Anthropic's own Slack product (Claude Tag) validated the opposite
model at scale: channel-scoped capability, no per-user account linking,
identical capability for everyone in the channel.

## Decision

Channel access is place-scoped for every messenger: the Agent owner
consents to a conversation surface — a Slack channel, a Telegram chat —
and anyone that messenger admits to the surface may drive the Agent,
every turn running on the main agent pod under the Agent's own
credentials. Per-user platform identity leaves the channel path
entirely: Slack identity linking, the per-Agent allowed-users gate, and
the per-turn foreign-replier fork are dropped.

Boundaries of the decision:

- Owner consent is the act of access control. Binding a channel means
  lending the Agent — credentials included — to everyone in that place.
  Membership of the place is governed by the messenger, not by the
  platform.
- Credential selection is per-Agent, never per-speaker. Who is typing
  changes nothing about what a turn can reach.
- Turns are attributed by messenger identity (Slack user id, Telegram
  user id) in the audit trail; no platform identity is resolved on the
  channel path.
- The owner's existing controls — human-in-the-loop approval rules and
  egress rules — gate every turn, whoever sent it.
- Both adapters follow the same single-track relay; future channels
  inherit one model instead of choosing a side.

## Alternatives Considered

- **Status quo (person-scoped Slack, place-scoped Telegram)** — two
  models to maintain; the fork path keeps its provisioning latency,
  unbounded concurrency, session race, and restart fragility.
- **Drop forks only, keep identity linking** — foreign turns run under
  the Agent's credentials but users still must link accounts; keeps the
  login friction and most of the dual model this decision removes.
- **Per-speaker credential injection without fork pods** — inject the
  replier's credentials at the main gateway per turn; keeps all
  per-user credential plumbing and adds turn-serialization concerns on
  a single gateway.
- **Dedicated service-account credentials per channel** — provisioning
  purpose-made non-personal credentials (the full Claude Tag shape) is
  complementary hardening, not a prerequisite; it can layer on later
  without reversing this decision.

## Consequences

- **Easier:** One relay path serves all channels — the fork subsystem
  (custom resource, reconciler, per-fork service accounts, network and
  authorization policies, paired gateway pods, sagas) is deleted
  outright, and its documented defects (unbounded concurrent forks, the
  same-thread session race, orphaned fork state after api-server
  restart) disappear rather than needing fixes. Foreign replies lose
  the per-turn pod-pair spin-up and its two-minute provisioning window.
  Slack onboarding drops to zero, matching Telegram and messenger-native
  expectations.
- **Harder:** The per-speaker credential boundary is given up — any
  member of a bound channel can exercise every connection the owner
  attached, so a compromised or careless channel member acts with the
  owner's authority, gated only by the owner's approval and egress
  rules. Per-user usage accounting and platform-identity audit on
  channels are no longer possible; attribution degrades to messenger
  identity. There is no platform-side way to exclude one member of a
  bound channel — exclusion means messenger-side removal or unbinding
  the channel.
- **Committed-to:** Owner consent as the load-bearing gate: connecting
  a channel is understood as lending the Agent's full authority to that
  place. Reintroducing any per-user capability difference on channels
  (credentials, gating, quotas) requires reversing this decision, not
  extending it.
