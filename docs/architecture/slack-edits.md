# Slack message edits

Last verified: 2026-11-11

What happens when someone edits a Slack message an Agent was sent or has read, and how an Agent changes a post of its own.
What a channel turn is lives on [channel-turns](channel-turns.md), threads a Session owns on [slack-threads](slack-threads.md), and which outcomes are guaranteed on [slack-guarantees](slack-guarantees.md).

## What counts as an edit

Slack reports a change to a post for many things that are not an edit: a link preview arriving, a pin, a reply count, a deleted post left as a tombstone.
The gateway passes on a change only when the post's text now reads differently, rendered the way a new post's text is.
The writer is read from the post as it is now, by the rule a new post is read with, so an edit to a post that could never start a turn is dropped too.
Edits arrive on the subscriptions plain messages already use, so they need no further scope.
A group DM has no such subscription, so an edit there never arrives, and neither does one on Telegram.
A deleted message is not an edit and is not followed.
An edit in a conversation no Agent is connected to, outside a thread a Session owns, is dropped at once.

## A message that still waits

A message waits from the moment it arrives until a turn takes it: while its files are fetched, through the quiet period, and behind a running turn.
An edit to a waiting message only replaces its text, whoever made the edit, files kept.
The Agent reads the message once, as it reads now, and is told of no change.

## Who an edit can start a turn for

Past that, an edit starts a turn only when a **person** made it, and only for a message an Agent was **sent**: a mention, a direct message, or a message in a thread one of the Agent's Sessions started.
Every other edit starts nothing: one by an Agent, one by an app, and one to a message Agents only read along.
An Agent that keeps one post current by editing it would otherwise cost every reader a turn per update, and two Agents could answer each other's edits in a loop.

## An edit follows its message

The platform remembers, per message, which Agents were sent it and the conversation queue that took it ([channel-turns](channel-turns.md#inbound--channel-message-to-acp-session)).
A person's edit takes that road again, and the queue decides what it becomes.

- **A turn carrying the message is running.** The edit is steered into that turn, so the one answer can already follow it; where the harness takes no steer it becomes the next turn.
- **The Agent already answered.** The edit starts a turn of its own on the Session that answered.

A delivered edit carries only the new text, marked as the text that replaces the message with that send time.
The earlier text is not repeated, because the Session already holds it.
The mark tells the Agent to correct what it did from the earlier text, to say what it cannot undo, and how to stay silent when the change needs no answer.
An edit turn is an addressed turn like a tagged reply in the thread: it shows the working status, and it is nudged when it ends having neither answered nor declined.

The binding is read again when the edit arrives, because the binding is the authorization and an edit can come long after its message: a conversation disconnected in between gets nothing.
An edit whose text the Agent already has, as when Slack reports one edit twice, starts nothing.
Direct messages outside a thread share one queue per sender, and a burst of them runs on the Session its first message opened.
An edit joins that queue only while it is still the one that took the message; later it goes to the Session the burst ran on, never into the turn of a newer direct message.
An edit in a thread a Session owns goes to the owning Session, as the message did, through that Session's queue.

## One message, sent once

Slack can report one message more than once: as a mention again when it is edited, and as both an edit and a mention when an edit first tags the bot.
Each Agent is therefore sent a message once, on a claim made before anything is fetched for it, and a later report of the same message starts nothing for that Agent.
A message that did not tag the bot was never sent to an Agent as a mention, so an edit that first tags the bot is a mention sent at that moment for every Agent not sent the message before.
Its turn carries the message as it reads now, with no edit mark.
An Agent that already holds the message, as the Session that owns its thread does, gets the edit instead.

## Edits a Session is shown later

Every edit is also kept, until each Session that holds the earlier text has been shown the new one.
A Session reads the record when a turn is built for it: a thread's Session reads that thread's edits, its opening message included, and a Session that reads a channel outside threads reads the edits of top-level messages.
It is owed the edits to messages it was already handed, at or below the newest message it has.
The turn lists each of those as it reads now, apart from the messages the turn asks about, and says that nobody is asking about the edit.
Every other edit noted by then is to a message the Session reads in that turn, with its current text.

When the turn is delivered, all of them are settled for that Session, so an edit is listed once.
A turn that fails settles nothing, and an edit made while a turn runs waits for the next one.
The Agent that wrote the message is owed nothing, and a later edit of the same message is owed again.
The same edit reported once more changes nothing, so it is not listed again.
Sessions are told apart, because one Agent can hold a message in several: the channel's Session and a thread's.

## An Agent changes its own post

An Agent changes a post it made earlier with one tool on its MCP endpoint ([channel-turns](channel-turns.md#outbound--agent-to-channel)).
It names the post by the conversation and the message reference the posting tool returned, and passes the whole new text and card.
The post then shows exactly that; nothing is merged with what it showed before.
A card is checked as on a new post, and a refused one leaves the post as it was ([channel-cards](channel-cards.md)).
An edit notifies no one, so an Agent that needs people to see the final state also replies.

- **Only its own post.** The bot posts for every Agent, so Slack would let any of them change any of the bot's posts.
  The platform reads the post back and changes it only when its [Agent Footer](channel-turns.md#the-agent-footer) names the calling Agent, and the platform writes that footer, never an Agent.
  The footer is read from the block that ends the post, where the platform puts it, because an Agent's card can show a link to another Agent's page earlier in the post.
  The platform also posts in an Agent's name, a greeting or a notice, with the same footer; a post therefore also carries, unseen, whether the Agent made it with one of its own tools, and only such a post is changed.
  Another Agent's post, a platform notice, a person's message and a message that does not exist are each refused.
- **Where it may post.** The conversation is held to the reach a new post has.
- **The footer stays.** The edited post names the Agent and the Session it named before, so it still opens the Session that made it, a deleted post's notice still finds that Session, and other Agents still read the post as that Agent's.
- **No file.** A post that carries a file is refused for now, and a private answer to a whisper has no reference to name.
- **A limit.** Slack takes about fifty edits a minute for a whole workspace, shared by every Agent there.
  The platform admits a little less per workspace and a smaller share per Agent, so one Agent cannot use up the others', and refuses the rest with the time to wait; it queues nothing.
  The limit is asked before the post is read back, so an edit that will be refused reads nothing from Slack.
- **A turn's answer.** An edit to a post in the thread a turn answers counts as answering that turn, as a reaction does.
- **Other Agents.** Slack reports the edit like any other, so it starts no turn, and each Session that holds the earlier text is listed the post in its next turn, as above.

In Telegram a text post names its chat and message the same way, and the same tool changes it.
A Telegram message carries nothing that names its Agent, the bot cannot read a chat's history, and message ids in a chat can be guessed.
So the platform records which Agent made which message with its own tool, in memory for two days, and changes only a message recorded for the calling Agent, in a chat still connected to it.
A notice the platform sends to the chat in the Agent's name is not recorded, so no Agent can change it.
After a restart an earlier message can no longer be changed, and a message sent with a file names no reference.
The limits are counted per chat there, since Telegram has no workspace.

## Limits

What the platform remembers about a message, and the edits still owed, is kept in the worker's memory for two days.
After a restart, or after two days, a person's edit to a mention or a direct message starts no turn, and no Session is listed a change.
A thread a Session owns is recorded in the database, so an edit there still reaches its Session.
If Slack reports the edited message as a mention again by then, that mention is the first one known and starts a turn as a new message.
Nothing stale is left behind either way: a message read from Slack later, in an injected history, a catch-up or a thread read, carries its current text and is marked as edited.
An edit changes text only; the files of a message stay as they were sent.
A reply in a whisper thread is not followed.
