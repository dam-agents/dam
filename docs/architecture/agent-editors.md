# Agent editors

Last verified: 2026-10-24

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

An editor opens the Agent's Environments like its owner: the owning Agent's editors are always on the list, and no Environment's own list narrows them out (see [environments](environments.md)).

## Sessions

The Agent's own runtime is reached through the agent proxies.
They admit the owner, and an editor who holds the permission each one needs: the chat socket, the runtime's tRPC socket and the browser stream need `sessions`, and the terminal and SSH sockets need `terminal`, which only the owner holds.
Every runtime procedure an editor may call maps to one permission, one map for the HTTP proxy and the tRPC socket alike.
The session screen and its side panels need `sessions`: sessions, files, the browser, changes, and a turn's processes.
The live model settings need `view`, and startup items and a pending restart need `lifecycle`.
A procedure not on the map, such as adding an SSH key or publishing, stays with the owner.
Over HTTP a batch with one such call is refused whole; on the socket the relay answers that one call with `FORBIDDEN` and passes the rest.
A session is full access to the Agent's machine anyway, since the Agent reads and changes any file it is asked to, so the side panels give an editor nothing more.

Read state stays the owner's (see [home feed](home-feed.md)).
The relay opens the runtime's chat socket for an editor with a flag that makes it a full viewer that never stamps a session seen, and it answers an editor's explicit mark-seen call itself.

An editor answers a tool call in the chat as the owner does, Allow always included.
The chat's network access and proposed rule cards are answered through the approvals procedures above.
The record of an approval names the person who answered it, owner or editor, and so does the Egress Rule an answer writes; the audit record of an editor's verdict also names the owner.

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
Under Shared with me, a Shared Agent lists its sessions as the owner's own Agents do; they are not in an editor's Activity, All sessions or Pinned.
A session of a Shared Agent carries the Shared badge in its top bar for the owner and the editors alike.
An editor's approval prompts in the chat add one line naming the owner and the Agent's connections other than its model providers, since the platform cannot know which one a tool call will use; the owner's prompts do not.
Where only the owner can continue a spend limit, the chat tells an editor to ask the owner by name.
An editor is not offered what they lack: no channel tiles without `channels`, no terminal or local editor tiles and no terminal sessions without `terminal`.
Shared Agents add nothing to an editor's Home feed or unread marks (see [home feed](home-feed.md)).
When an editor loses access while the Agent is open, the page goes home and says so by name, rather than to the owner's [public agent page](public-agent-page.md).

## Audit

Each change to a list is an audit record naming who was added and who was removed, and an editor leaving is one too (see [logging](logging.md)).
Each change an editor makes to a Shared Agent, each socket they open to it, and each refusal, is an audit record naming the editor, the owner, the permission and the procedure or socket.
The Agents context's own records of a change name the editor as the actor.

## Known limits

- An expired connection stops the Agent until its owner fixes it; an editor cannot.
- Editors have no CLI or API access to Shared Agents.
- The owner and an editor saving the same whole-list form at once: the last save wins.
- A new host an Environment asks for, and a spend limit that stops the Agent, file approvals on the owner's Home only.
- An editor's turns count toward the owner's own spend limits.
- An editor can delete any session of the Agent, the owner's included.
- Turns and sessions do not yet show which person sent or started them.
- The owner is not told when an editor changes something; the audit trail names the editor.
- When the owner's account is gone, a notice names a former user, so there is nobody to ask.
- Matching depends on the identity provider marking emails verified.
