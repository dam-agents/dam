# Slack channel history a binding opts into

Last verified: 2026-11-09

How an Agent reads a Slack conversation further back than the window a new conversation is handed, and why that reach stops at the conversations that turned it on.
Bindings and their other modes live on [channels](channels.md), what a turn is handed on [channel-turns](channel-turns.md), and which outcomes are guaranteed on [slack-guarantees](slack-guarantees.md).

## The switch

**Channel history** is a mode of one Slack binding, beside ambient mode: it lets that Agent read the conversation's older top-level messages, and the threads they open, past the window a new conversation is handed.
It is **off by default** on every connect path — the in-chat bind, the UI form and the CLI — and the person connecting turns it on, or later a re-connect or the in-chat history command does, under the binder-or-owner authorization the ambient command uses.
A re-connect sets ambient mode and channel history together, so a surface that changes one sends the other as it stands.
Every change is security-logged, none is announced in the channel, and the agent list says which Agents have it.
Telegram has no such switch: its bot cannot read history.

## Reach

The bot can read every conversation it sits in, so the switch, not the bot's reach, is the boundary.
A read names one conversation and is refused where that binding has channel history off; the refusal names the conversations where it is on.
The check runs on every read, not when a Session starts, so turning the switch off stops the reading at once.
The reading tool, `read_channel_history`, is offered only to an Agent with channel history on for at least one binding; a harness lists its tools when its session starts, so a switch turned on mid-session shows from the next one, and the turn's contract tells the Agent so.
Any of the Agent's Sessions may read — a channel turn, a web chat, a scheduled run — since turning it on is the conversation's consent and the bot already reaches bound conversations from any of them.
What the Agent reads lands in its Session, which its owner can see: the exposure ambient mode already carries.

## Reading

A read returns one page of top-level messages, the newest page first and each page oldest first, labelled like injected history.
Older pages are reached with the cursor a page returns; the cursor names its conversation, so one from elsewhere is refused, and keeps the start of a time range, so following it never runs past that start.
A time range reads one stretch, such as the last week, and nothing limits how far back a read goes beyond what the workspace keeps.
A message that opened a thread carries the same thread tag as the injected window, so the thread reader opens it — while channel history stays on for that binding.
A turn in a conversation with channel history on names the tool, because a turn inside a thread is otherwise handed only that thread.
Searching a conversation is not offered: Slack's search needs a person's token, not the bot's.
