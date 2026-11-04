---
id: 129
title: A Session owns the Slack threads it starts
status: accepted
subsystem: channel-turns
tags: [slack, sessions, threads]
summary: A Session that starts a Slack thread with start_thread owns it, and every later message there, from a person or an agent, becomes a turn of that Session; a plain post stays one-way, and the ownership record lives in the platform.
---

# ADR-129: A Session owns the Slack threads it starts

**Date:** 2026-11-04
**Status:** Accepted
**Owner:** @pilartomas
**Amends:** ADR-021

## Context

ADR-021 made outbound posts fire-and-forget: a reply under an Agent's post opens a new Session, and the Session that posted never sees it.
Agents now ask people and other Agents in other channels, from web chats and scheduled runs, and the answer has to come back to the Session that asked.
The workaround needs three steps that can each break: the asker tells the other side to reply in the thread and tag it, a new Session wakes only to forward the answer with `send_session_message`, and that Session learns from the post itself that it must forward.

## Decision

A Session that starts a Slack thread with `start_thread` owns it, and every later message in that thread, from a person or another Agent, tagging the Agent or not, becomes a turn of that Session.
No other Session of that Agent is opened or woken for the thread.

- **Two posting tools.** `start_thread` posts and records ownership; `post`, `send_channel_message` renamed, is a one-way announcement whose replies are not followed. The old name stays one release as a deprecated alias, because definitions outside this repository call it.
- **The platform keeps the record.** Which Session owns which thread is stored by the platform, so a reply is routed without waking the Agent to list its Sessions, and a restart keeps it.
- **Ownership ends** when the Session leaves the thread with `leave_thread`, or turns out gone when a reply arrives; a reply then takes the road it would have taken in an unowned thread.
- **Owned threads stay apart from a channel Session's own thread.** A channel Session keeps the one thread it was opened for; ownership is a separate record, and only `start_thread` creates it.
- **One Session, one turn at a time.** Messages from all the threads a Session owns wait in one queue per Session, and steer into its running turn where the harness can take them, so two threads never prompt one Session at once.
- **Delivery is judged per thread.** Each owned thread has its own delivery boundary, so a message from one thread is never counted as delivered or missed because of another.
- **Channel content, never the operator.** A turn from an owned thread is framed as messages from the thread's members, naming the chat and thread a reply must pass, because in a web chat or scheduled Session an unframed message reads as the operator's.
- **No loops.** The owning Agent's own posts never come back to it, and bot posts pass the existing rate limit.
- **Another Agent tagged in an owned thread still answers it as its own turn**, which is how one Agent asks another.

## Amends

- **ADR-021** — its fire-and-forget threading model holds for `post`; a thread started with `start_thread` is routed back to the Session that started it, the mapping ADR-021 rejected.

## Alternatives Considered

- **Every outbound post owns its thread** — an announcement would wake a finished Session on each reply, the case the issue asks to keep one-way.
- **Keep forwarding through `send_session_message`** — two Sessions per answer, and the forwarding instruction rides in a post anyone can rewrite.
- **Record ownership in the Agent's Session metadata** — routing a reply would wake a hibernated Agent just to find the owner, and nothing could be routed while it starts.

## Consequences

- **Easier:** a Session acts on the answer to its own question; the forwarding hop and its extra Session per answer are gone.
- **Easier:** a scheduled run that asks gets its answer as a later turn of the same Session, after its own turn ended.
- **Harder:** a Session that owns many threads takes all their traffic, and its context grows and compacts sooner; accepted on purpose.
- **Harder:** a reply in an owned thread costs one database read before routing, on every thread message the bot sees.
- **Harder:** Telegram has no threads, so `start_thread` refuses it, and a Telegram answer still reaches only that chat's own Session.
- **Committed-to:** a platform table of thread owners, removed with the Agent; and the `post` name, with the `send_channel_message` alias to delete after one release.
