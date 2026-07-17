# ADR-NNN: Per-Channel Access Modes — Shared and Person-Scoped

**Date:** 2026-07-17
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

The first draft of this ADR proposed converging every messenger on
place-scoping and deleting the fork subsystem outright. Review
concluded the per-speaker credential boundary is worth keeping
available: some channels want each speaker to act with their own
authority and appear as themselves in audit and usage records. The
revised decision keeps both models and makes the choice explicit,
per channel, at bind time.

## Decision

Channel access mode is chosen per channel when the channel is bound.
The Agent owner performing the binding is prompted with a toggle and
picks one of two modes:

- **Shared ("system Agent") mode — place-scoped.** Anyone the
  messenger admits to the surface may drive the Agent. Every turn runs
  on the main agent pod under the Agent's own credentials. No per-user
  platform identity is resolved on the turn path; turns are attributed
  by messenger identity (Slack user id, Telegram user id) in the audit
  trail.
- **Person-scoped mode.** The existing Slack model, retained as is:
  members must link a platform identity before the bot answers them,
  the per-Agent allowed-users gate applies, the owner's turns relay to
  the main pod, and any other authorized member's turn runs in a
  per-turn fork under that member's own credentials.

Boundaries of the decision:

- The mode is a property of the binding, set by the binding owner at
  bind time. The bind flow states plainly what shared mode means:
  everyone in this place will act with this Agent's credentials.
- *Proposed default:* person-scoped. Lending the Agent's full
  authority to a room is the wider grant, so it is the explicit
  opt-in, not the default.
- *Proposed switching semantics:* changing mode means unbinding and
  rebinding. Sessions minted under one mode are never resumed under
  the other, so a mode flip never mixes credential contexts inside one
  conversation.
- The toggle appears only where both models are implemented — Slack
  today. Telegram remains shared-only: no per-user identity
  infrastructure exists there and this decision does not build it.
  Future channel adapters must implement shared mode; person-scoped
  mode is optional, gated on the messenger having a workable per-user
  identity story.
- In shared mode, owner consent is the act of access control:
  binding lends the Agent — credentials included — to everyone in that
  place, and membership of the place is governed by the messenger.
  Credential selection is per-Agent, never per-speaker.
- In both modes, the owner's existing controls — human-in-the-loop
  approval rules and egress rules — gate every turn, whoever sent it.

## Alternatives Considered

- **Full convergence on place-scoping (this ADR's first draft)** —
  deletes the fork subsystem and its defects wholesale; rejected
  because it removes the per-speaker credential boundary everywhere,
  and some channels legitimately want speaker-authority turns.
- **Status quo (person-scoped Slack, place-scoped Telegram)** — the
  model is an accident of the adapter rather than a choice; Slack
  channels that want zero-onboarding shared access have no path to it.
- **Drop forks only, keep identity linking** — foreign turns run under
  the Agent's credentials but users still must link accounts; keeps
  the login friction while giving up the credential boundary that
  justified it.
- **Per-speaker credential injection without fork pods** — inject the
  replier's credentials at the main gateway per turn; keeps all
  per-user credential plumbing and adds turn-serialization concerns on
  a single gateway.
- **Dedicated service-account credentials per channel** — provisioning
  purpose-made non-personal credentials (the full Claude Tag shape) is
  complementary hardening for shared mode, not a prerequisite; it can
  layer on later without reversing this decision.

## Consequences

- **Easier:** Slack channels that opt into shared mode get zero
  onboarding and a single relay path, which is the structural
  prerequisite for the open-speaker-set feature class: un-mentioned
  thread follow-ups, one shared session per thread that anyone can
  steer, and ambient (non-tagged) replies. Telegram's behavior becomes
  a named, documented mode instead of an adapter quirk. Channels that
  keep person-scoped mode lose nothing.
- **Harder:** Both relay paths are now permanent. The fork subsystem
  is hardened instead of deleted — its documented defects (unbounded
  concurrent forks, the same-thread session race, orphaned fork state
  after api-server restart) become fix-work on a kept code path
  rather than disappearing. Every future channel capability must
  either serve both modes or declare itself shared-mode-only; progress
  streaming and ambient listening are the immediate examples, since a
  per-turn fork pod has no stable surface to stream from and an
  unlinked member's message still cannot run a turn on a person-scoped
  channel. The bind flow grows mode UX, consent copy, and per-mode
  documentation.
- **Mode-gated capability:** features that require an open speaker set
  exist only on shared channels. This is structural, not policy — on a
  person-scoped channel, a message from an unlinked member has no
  identity to run under and can only be refused.
- **Committed-to:** Both models are load-bearing product surface, and
  the bind-time toggle is the contract with owners. Retiring either
  mode later is a new decision with a migration for every bound
  channel, not a cleanup.
