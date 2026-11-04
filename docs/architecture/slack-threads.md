# Slack threads a Session owns

Last verified: 2026-11-04

How a Slack thread an Agent's Session started with `start_thread` brings every later message in it back to that Session.
What a plain post and a channel turn are lives on [channel-turns](channel-turns.md); which outcomes are guaranteed is mapped on [slack-guarantees](slack-guarantees.md).

## The record

A thread started with `start_thread` is **owned** by the Session that started it, from a web chat, a scheduled run or a channel turn alike.
The platform keeps the record — chat, thread, Agent, Session, and the newest message the Session was handed — in Postgres, so a reply is routed without waking the Agent to list its Sessions, and a restart keeps it; the record goes with the Agent.
It is kept apart from a channel Session's own thread key, which still says "this is a channel session" and is never an owned thread.
Every message in an owned thread, from a person or another Agent, tagging the Agent or not, becomes a turn of the owning Session, and no other road of that Agent takes it: no thread session opens, and a read-along binding skips it.
Another Agent tagged there still answers as its own turn, which is how one Agent asks another.
The owning Agent's own posts never come back to it, and bot posts pass the bot-post rate limit once, so two Agents cannot wake each other in a loop there.

## Turns

The messages of all the threads one Session owns wait in **one queue per Session**, gathered over the same quiet period as other conversations: two owned threads never send two prompts into one Session at once.
A message arriving while that Session runs a turn — the owner's web chat turn included — is steered into it where the harness can take one, at a steer point ([sessions](sessions.md#prompt-delivery)); one with attachments waits for a turn of its own.
The turn is sent on the runtime's message surface, the one a message from another of the Agent's Sessions uses, so it is unattended, may join a running turn, and is never framed as the operator's.
Its prompt says the text is channel content from the thread's members, not from whoever works with the Session, names the chat and thread each message came from, and says that plain text reaches nobody in Slack: the Agent answers with `reply`, passing that chat and thread, which needs no turn in flight.
It also says later replies come back the same way, so the Agent ends its turn rather than waiting.

## Delivery

Delivery is judged **per thread**: each owned thread has its own boundary, and a turn that carried messages from several threads moves each thread's boundary to its own newest message.
A turn that fails moves none, so the next one shows what came after the boundary — capped at a thread read — as earlier context; nothing is presented twice.
No undelivered-turn nudge runs: nobody in the thread summoned the Session, which may be a chat whose person answers it later.

## Tools and the end of ownership

Ownership ends when the Session calls `leave_thread`, or when a reply finds the Session gone; the record is dropped and that reply takes the road an unowned reply takes.
`list_threads` reports the calling Session's threads, with Slack's reply count and last activity read at the call, and whether a message from someone else came after the boundary.
`read_thread` reads an owned thread as it reads one an injected history offered.
Every thread tool needs the calling Session's id, which the platform resolves from the call; a call it cannot tie to a Session is refused.
Telegram has no threads: `start_thread` refuses it, and a Telegram chat's next message still reaches that chat's own session.
`post`, the one-way tool, was called `send_channel_message`; the old name stays one release as a deprecated alias with the same behavior, since definitions outside the platform call it.
Its result says, per messenger, where an answer goes: on Slack nowhere back to the calling Session, which asks with `start_thread` instead; on Telegram to that chat's own session.
