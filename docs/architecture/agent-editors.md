# Agent editors

Last verified: 2026-10-27

## Overview

An Agent has exactly one owner.
The owner can name **Agent Editors**: other people who work on the Agent with them.
The Agent's **Editor List** holds them, and an Agent with at least one editor is a **Shared Agent**, shown to users as **Shared**.
A Channel Binding never makes an Agent shared: that is Shared Access, a different thing (see [channels](channels.md)).

An editor is not a second owner.
The Agent keeps running on its owner's budget and connections, and only the owner changes the Editor List or deletes the Agent.
An editor changes the Agent's set-up much as its owner does: its settings, environment variables, Egress Rules, skills, schedules, chat forms, Environments and spend limits, and they can disable, restart and update it.
An editor also uses its sessions as its owner does: they start and continue them, chat, and answer the approvals the Agent asks for in the chat.
What reaches the owner's credentials or decides who can talk to the Agent stays with the owner: its connections and providers, the credential injection switch, a Secret named by secretRef, its Channel Bindings and whispers, and its skill library.
So do its terminals and SSH.

## The Editor List

The list is a Postgres table owned by the Agents context: one row per Agent and email.
It stores lowercased email addresses, not user ids, the same way the [artifact library](artifact-library.md)'s viewer list does, because a listed person may never have signed in.
The owner replaces the whole list at once, and the store works out who was added and who was removed in one transaction.
The list holds at most fifty people, and the owner's own email is refused.

The rows follow the Agent: they are one of the agent-scoped record kinds that an Agent delete and the orphan sweep clean up (see [persistence](persistence.md)).

## Who matches

A person matches an Editor List only by a **verified** email from their sign-in.
The api-server reads the email and its verified flag from the access token; an unverified email, and every API key, matches nothing.
So editors reach a Shared Agent only in the web UI, never through the CLI or an API key.

One check decides how a person stands to an Agent: **owner** when the Agent's owner label is their user id, **editor** when their verified email is on its list, and no access otherwise.
No access reads exactly like an Agent that does not exist.

Listing has two scopes.
**Mine** is the owner's own agents, as the CLI has always seen them.
**All** adds the agents shared with the caller, which the web UI asks for.
Each listed Agent says the caller's role and the Editor List; an editor also gets the owner's email, read from the Keycloak User Directory, so the UI can say whose agent it is.
An owner whose account is gone reads as a former user.

## Agent Permissions

What a person may do to an Agent is a fixed list of named **Agent Permissions**, such as `schedules`, `egressRules`, `connections` or `delete`.
One policy in the Agents context maps a role to its permissions: the owner holds every one, an editor a fixed set.
The role stays a label; every check and every lock in the UI asks for a permission, so an owner can later choose the set.
Each listed Agent carries the caller's permissions next to their role.

Each agent-scoped procedure declares the permission it needs, in a middleware in the contract package.
The middleware finds the Agent from the input: an Agent id, or a schedule, Egress Rule or Environment, read without an owner scope.
Only an editor is affected.
An editor who holds the permission runs the procedure in a context made for the Agent's owner, bound to that one Agent and naming the editor as the person acting.
The services then work as they do for the owner: on the owner's budget, connections, skill library and records, with their own owner checks unchanged.
An editor without the permission gets `FORBIDDEN`, never `NOT_FOUND`.
The owner, an API key and a stranger keep their own context, so their answers do not change.

Reads of the Agent's set-up need `view`, so an editor reads the owner's schedules, rules, skill sets and spend status for that Agent.
Reading the Agent's connections returns each granted connection's display fields, read on the owner's behalf and never with secrets: that is all an editor sees of the owner's connections.
The updates the Agent context once took in one procedure are now one procedure per permission: settings, environment variables, the credential injection switch, whispers and secretRef.

An approval names only its id, so the middleware reads the Agent from the approval, and the approval adds the permission of what it lets through: `sessions` for a tool call, `egressRules` for network access or a rule the Agent proposes.
A spend limit question names no Agent for this check, because continuing it raises the owner's own spending: it stays with the owner.

An editor opens the Agent's Environments like its owner, and sets the Agent's Environment Members on its page; adding a person to one Environment is the owner's, in the Artifacts list (see [environments](environments.md#surfaces)).

## Sessions

The Agent's own runtime is reached through the agent proxies.
They admit the owner, and an editor who holds the permission each one needs: the chat socket, the runtime's tRPC socket and the browser stream need `sessions`, and the terminal and SSH sockets need `terminal`, which only the owner holds.
Every runtime procedure an editor may call maps to one permission, one map for the HTTP proxy and the tRPC socket alike.
The session screen and its side panels need `sessions`: sessions, files, the browser, changes, and a turn's processes.
The live model settings need `view`, and startup items and a pending restart need `lifecycle`.
A procedure not on the map, such as adding an SSH key or publishing, stays with the owner.
A path with a character a procedure name cannot have, such as a percent escape, is refused, because tRPC decodes the path before it splits a batch.
Over HTTP a batch with one such call is refused whole; on the socket the relay answers that one call with `FORBIDDEN` and passes the rest.
A session is full access to the Agent's machine anyway, since the Agent reads and changes any file it is asked to, so the side panels give an editor nothing more.

Read state stays the owner's (see [home feed](home-feed.md)).
The relay opens the runtime's chat socket for an editor with a flag that makes it a full viewer that never stamps a session seen, and it answers an editor's explicit mark-seen call itself.

An editor answers a tool call in the chat as the owner does, Allow always included.
The chat's network access and proposed rule cards are answered through the approvals procedures above.
The record of an approval names the person who answered it, owner or editor, and so does the Egress Rule an answer writes, or a person writes by hand; the audit record of an editor's verdict also names the owner.

### Who did what

The owner and the editors work in the same Sessions, so a Session records who did what in it.
The chat relay writes the person signed in on the socket into every prompt, queue edit and rewrite as its **Sender**, and into every answer to a tool call approval as who answered; an answer given on Home carries who gave it the same way.
It replaces whatever the client wrote there, because only the relay knows who is signed in.
The runtime keeps, in the Session's metadata, each Sender with the time its prompt started and its prompt id, the **Session Starter**, and each tool call's verdict with who gave it, keyed by the harness's own tool call id (see [sessions](sessions.md)).
A Sender is the user id, which decides "You", and the email at the time, which is what the UI shows, so a person removed later is still named.
Only a person is a Sender: a prompt the platform makes has none, and a scheduled or channel Session has no Session Starter.
Attribution never depends on the Agent being shared now, so a Session an editor wrote to still names them after they leave.

The chat marks a change of Sender with a divider that names the email, or "You": the first message a person sent gets one only when that person is not the viewer, so a Session only one person wrote to looks as it always did.
A divider that falls on a day divider joins it into one line, and messages the Agent took as one batch are split where the Sender changes.
While a turn runs, "Working for" names its Sender beside the working indicator, unless the turn is the viewer's own or has no Sender.
A queued prompt names its Sender when it is not the viewer, and editing it makes the editor its Sender.
The line under a tool call names who allowed or denied it when that is someone else, and the line now outlives a reload for everyone.
Session lists name the Session Starter after the time when it is not the viewer: Activity and All sessions read it from the attention record ([home feed](home-feed.md)), an Agent's own list from the Agent.
The Egress Rules list names who wrote a rule by email, or "you".

Each replica remembers the sockets editors hold open, per Agent.
A change to the Editor List or a delete of the Agent asks every replica, over the bus, to check those editors again, and a socket whose editor no longer stands as one is closed with "access revoked".
Each admission of an editor to a socket is an audit record.

## Live hints

The [live hints](platform-topology.md) bus addresses a user id.
An editor's browser stream also listens on a second audience: their verified email.
Every publisher still addresses the owner; a hint with the topic `agents`, `schedules`, `harnessConfig`, `approvals` or `attention` is copied to the email audience of each of the Agent's editors, read from a short per-replica cache that a change to the list clears.
A change to the list also tells each person it added or removed, so the Agent appears in or leaves their sidebar at once.
When the owner deletes the Agent, the cleanup that drops its list tells its editors the same way.

## In the web UI

The owner's sidebar marks a Shared Agent with a people icon whose tooltip names the editors; the agent's **People** settings section edits the list, under a warning of what an editor can see and do.
An editor finds the Agent under **Shared with me**, apart from their own agents, and its page shows a Shared badge and who owns it.
Their page is the owner's page with every control they lack permission for hidden or disabled.
A section where they hold none of its permissions carries a lock in the section list: People, Connections and Channels.
Each such page opens with a notice that says what only the owner does, why, and names the owner to ask; Providers has one too, with its switches disabled.
Where the owner would delete the Agent, a line says only the owner can.
Under Shared with me, a Shared Agent lists its sessions as the owner's own Agents do, and its row and chevron act as theirs do: a click on its closed row opens its new-session page and its list, a click on its open row closes the list; its sessions are not in an editor's Activity, All sessions or Pinned.
A session of a Shared Agent carries the Shared badge in its top bar for the owner and the editors alike.
An editor's approval prompts in the chat add one line naming the owner and the Agent's connections other than its model providers, each with the account it acts as when that is known ("GitHub as tomkis"), since the platform cannot know which one a tool call will use; the owner's prompts do not.
Wherever the owner gives a Shared Agent a connection, they are reminded that its editors can use it with the owner's access.
The People warning lists the Agent's connections and their accounts, three and then a tooltip.
Adding a connection to a Shared Agent asks first, in one dialog with the channel warning when the Agent is also bound to a channel.
Each of the two warnings has its own "Don't show again", and once it is off the catalog shows a notice instead.
The Connections page of a Shared Agent opens with a notice naming the editors, and the secret-entry page names the editors of each Shared Agent the new or replaced secret goes to.
Where only the owner can continue a spend limit, the chat tells an editor to ask the owner by name.
An editor is not offered what they lack: no channel tiles without `channels`, no terminal or local editor tiles and no terminal sessions without `terminal`.
Shared Agents add nothing to an editor's Home feed or unread marks (see [home feed](home-feed.md)).
When an editor loses access while the Agent is open, the page goes home and says so by name, rather than to the owner's [public agent page](public-agent-page.md).

**Profiles** are the owner's, not the Agent's: the model picker of a Shared Agent offers the owner's profiles, and a pick stores one on the Agent's chat default or its subagent slot, which is a set-up change an editor may make.
An editor reads that set and references it, and never changes it: saving a pick as a profile, renaming one or deleting one is the owner's alone, the picker offers no save on a Shared Agent, and a write that arrives with the Agent named is refused rather than written into the editor's own set — the owner's other Agents point at those profiles too.
Listings made without an Agent stay the caller's own, which is what Settings shows.

## Audit

Each change to a list is an audit record naming who was added and who was removed, and an editor leaving is one too (see [logging](logging.md)).
Each change an editor makes to a Shared Agent, each socket they open to it, and each refusal, is an audit record naming the editor, the owner, the permission and the procedure or socket.
The Agents context's own records of a change name the editor as the actor.

## Known limits

- An expired connection stops the Agent until its owner fixes it; an editor cannot.
- Editors have no CLI or API access to Shared Agents.
- The CLI does not warn when the owner grants a connection to a Shared Agent, as it does not for a channel-bound one.
- The owner and an editor saving the same whole-list form at once: the last save wins.
- A new host an Environment asks for, and a spend limit that stops the Agent, file approvals on the owner's Home only.
- An editor's turns count toward the owner's own spend limits.
- An editor can delete any session of the Agent, the owner's included.
- A Sender with no email, the owner on an API key, is named by the owner's email to editors.
- Who allowed a single network access request once is in the audit record only.
- The owner is not told when an editor changes something; the audit trail names the editor.
- When the owner's account is gone, a notice names a former user, so there is nobody to ask.
- Matching depends on the identity provider marking emails verified.
