---
id: 079
title: One channel access model — the binding is the authorization
status: accepted
supersedes: [027, 076]
subsystem: channels
tags: [slack, telegram, forks, credentials]
summary: Per-person channel access (identity linking, allow-lists, per-turn impersonation forks) is removed; every binding lends the Agent to the conversation and every turn runs as the Agent, attributed to the messenger-native sender.
---

# ADR-079: One channel access model — the binding is the authorization

**Date:** 2026-07-29
**Status:** Accepted
**Owner:** @jezekra1

## Context

Slack bindings carried two access modes: person-scoped (the default — identity linking, a per-Agent allowed-users list, and a per-turn fork pod pair impersonating the replier with their own credentials) and shared (the binding itself authorizes anyone in the channel). Nobody used person-scoped, and it charged the whole platform for existing: forks were the reason every workspace volume had to be shared-writable (a second pod writes into a live agent's workspace), which forced every install onto a shared filesystem; the isolation it promised didn't hold (credentials split per person, the workspace didn't — any channel member could plant instructions the agent later executed under the owner's credentials); and it doubled the product surface (two modes, an allow-list, a choice fixed at bind time).

## Decision

There is exactly one access model: binding a conversation to an Agent is the authorization, and anyone the messenger admits to that conversation drives the Agent under the Agent's own credentials. Turns are attributed by messenger-native sender id in the security log and speaker-labelled in the prompt; the binding owner's Terms-of-Use acceptance gates every turn. The per-turn fork machinery, the access-mode choice, and the allowed-users list are removed outright, not switched off. Identity linking stays only to authorize the in-chat bind/unbind/ambient commands. Existing person-scoped bindings are **deleted** at upgrade, not converted — silently flipping them to the open model would widen who may drive an agent without its owner deciding that; the owner re-binds, which is the consent.

## Alternatives Considered

- **Keep person-scoped as an option** — its per-person isolation was cosmetic (shared workspace defeats the credential split) and its existence alone forced shared-writable storage on every agent.
- **Convert existing person-scoped bindings to the open model** — a silent authorization widening; deletion + explicit re-bind keeps consent with the owner.
- **Keep the fork machinery dormant for later** — dormant code still pins the RWX storage requirement, which is the cost the removal exists to eliminate.

## Consequences

- **Easier:** agent storage no longer needs a second concurrent writer, unblocking single-writer volumes (ADR-080); the connect surface loses the mode picker, the allow-list editor, and the fixed-at-bind-time constraint; Slack and Telegram now behave identically.
- **Harder:** a colleague who needs to act under their *own* credentials needs their own Agent — there is no per-person credential switching on a shared one; per-person usage attribution inside a binding is messenger-id-based only (no Keycloak identity per turn).
- **Committed-to:** the binding as the sole authorization gate — every future channel type inherits "membership of the surface = permission to drive", so consent UX lives at bind time, not per person.
