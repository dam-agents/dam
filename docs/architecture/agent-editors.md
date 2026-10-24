# Agent editors

Last verified: 2026-10-24

## Overview

An Agent has exactly one owner.
The owner can name **Agent Editors**: other people who work on the Agent with them.
The Agent's **Editor List** holds them, and an Agent with at least one editor is a **Shared Agent**, shown to users as **Shared**.
A Channel Binding never makes an Agent shared: that is Shared Access, a different thing (see [channels](channels.md)).

An editor is not a second owner.
The Agent keeps running on its owner's budget and connections, and only the owner changes the Editor List or deletes the Agent.
Today an editor can see the Agent, who owns it, and who else edits it, and can take themselves off the list.
Changing the Agent's set-up and using its sessions come later; until then the editor's view of the Agent's page holds only its general facts and its people.

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
The check is wider only where it is asked.
Listing agents and reading one Agent ask it; every other operation still asks only whether the caller is the owner, so an editor cannot change, wake, chat with or delete the Agent.

Listing has two scopes.
**Mine** is the owner's own agents, as the CLI has always seen them.
**All** adds the agents shared with the caller, which the web UI asks for.
Each listed Agent says the caller's role and the Editor List; an editor also gets the owner's email, read from the Keycloak User Directory, so the UI can say whose agent it is.
An owner whose account is gone reads as a former user.

## Live hints

The [live hints](platform-topology.md) bus addresses a user id.
An editor's browser stream also listens on a second audience: their verified email.
Every publisher still addresses the owner; a hint about an Agent is copied to the email audience of each of its editors, read from a short per-replica cache that a change to the list clears.
A change to the list also tells each person it added or removed, so the Agent appears in or leaves their sidebar at once.
When the owner deletes the Agent, the cleanup that drops its list tells its editors the same way.

## In the web UI

The owner's sidebar marks a Shared Agent with a people icon whose tooltip names the editors; the agent's **People** settings section edits the list, under a warning of what an editor can see and do.
An editor finds the Agent under **Shared with me**, apart from their own agents, and its page shows a Shared badge and who owns it.
Shared Agents add nothing to an editor's Home feed or unread marks (see [home feed](home-feed.md)).
When an editor loses access while the Agent is open, the page goes home and says so by name, rather than to the owner's [public agent page](public-agent-page.md).

## Audit

Each change to a list is an audit record naming who was added and who was removed, and an editor leaving is one too (see [logging](logging.md)).

## Known limits

- An expired connection stops the Agent until its owner fixes it; an editor cannot.
- Editors have no CLI or API access to Shared Agents.
- Matching depends on the identity provider marking emails verified.
