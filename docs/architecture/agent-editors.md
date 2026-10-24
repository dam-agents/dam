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
What reaches the owner's credentials or decides who can talk to the Agent stays with the owner: its connections and providers, the credential injection switch, a Secret named by secretRef, its Channel Bindings and whispers, and its skill library.
Using its sessions comes later.

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

The Agent's own runtime is reached through the agent proxies, which admit only the owner.
The HTTP proxy also admits an editor for the few runtime calls the Agent's page needs: its live model settings, its process list and applying a pending restart.
Sessions, files and terminals stay with the owner, and the live sockets admit no editor, so an editor's page reads the runtime over HTTP.

An editor opens the Agent's Environments like its owner: the owning Agent's editors are always on the list, and no Environment's own list narrows them out (see [environments](environments.md)).

## Live hints

The [live hints](platform-topology.md) bus addresses a user id.
An editor's browser stream also listens on a second audience: their verified email.
Every publisher still addresses the owner; a hint about an Agent, its schedules or its model settings is copied to the email audience of each of its editors, read from a short per-replica cache that a change to the list clears.
A change to the list also tells each person it added or removed, so the Agent appears in or leaves their sidebar at once.
When the owner deletes the Agent, the cleanup that drops its list tells its editors the same way.

## In the web UI

The owner's sidebar marks a Shared Agent with a people icon whose tooltip names the editors; the agent's **People** settings section edits the list, under a warning of what an editor can see and do.
An editor finds the Agent under **Shared with me**, apart from their own agents, and its page shows a Shared badge and who owns it.
Their page is the owner's page with every control they lack permission for hidden or disabled.
A section where they hold none of its permissions carries a lock in the section list: People, Connections and Channels.
Each such page opens with a notice that says what only the owner does, why, and names the owner to ask; Providers has one too, with its switches disabled.
Where the owner would delete the Agent, a line says only the owner can.
Shared Agents add nothing to an editor's Home feed or unread marks (see [home feed](home-feed.md)).
When an editor loses access while the Agent is open, the page goes home and says so by name, rather than to the owner's [public agent page](public-agent-page.md).

## Audit

Each change to a list is an audit record naming who was added and who was removed, and an editor leaving is one too (see [logging](logging.md)).
Each change an editor makes to a Shared Agent, and each refusal, is an audit record naming the editor, the owner, the permission and the procedure.
The Agents context's own records of a change name the editor as the actor.

## Known limits

- An expired connection stops the Agent until its owner fixes it; an editor cannot.
- Editors have no CLI or API access to Shared Agents.
- The owner and an editor saving the same whole-list form at once: the last save wins.
- A new host an Environment asks for, and a spend limit that stops the Agent, still file approvals on the owner's Home only.
- The owner is not told when an editor changes something; the audit trail names the editor.
- When the owner's account is gone, a notice names a former user, so there is nobody to ask.
- Matching depends on the identity provider marking emails verified.
