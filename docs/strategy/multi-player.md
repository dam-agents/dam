# Platform is multiplayer, not multitenant yet

> **TL;DR.** Platform is a shared platform for AI agents. Each agent belongs to one person — its owner. To let colleagues use an agent, the owner connects it to a shared surface (a Slack channel, a Telegram chat, …). Colleagues can watch for free. They can only talk to the agent if the owner adds them to an access list. When a colleague talks to it, the agent acts as *them*, not the owner.

## The big idea

One installation of Platform hosts one team. Everyone on the team signs in. Everyone can build their own agents. By default, **your agents are yours** — nobody else on the installation sees them or can interact with them.

Sharing an agent is an explicit choice. You share by connecting it to a **shared surface** — a Slack channel, a Telegram chat, or other integrations over time. In Platform, that connection is called a **channel**.

## Who are you, to Platform?

Platform uses a single sign-on system, the same way most enterprise applications do. Your corporate SSO sits behind it, so "who you are in Platform" is the same identity you use everywhere else at work. Every request you make carries proof of that identity.

When you reach Platform from Slack or Telegram, the first step is linking your account on that platform to your Platform identity. After that, Platform knows exactly which person is on the other end of every message.

## What's yours is yours

When you create an agent, you're its **owner**. You own:

- The agent itself.
- Its schedules (when it runs on its own).
- Its conversations.
- Any credentials you configured on it (for example, a bot token).

Other people on the installation cannot see any of that. Not in the dashboard, not through any menu. Your agents are invisible to them unless you choose otherwise.

> **Example.** Alice creates an agent called `my-researcher`. Her colleague Bob doesn't see it anywhere. He has no idea it exists.

## Your credentials stay yours

Agents need credentials to do real work — call GitHub, read email, hit internal APIs. Platform tracks credentials per person. When your agent runs, it uses *your* credentials, and only yours. It cannot reach anyone else's.

A component called the **credential gateway** hands credentials to agents. It checks your identity first. No identity, no credentials.

> **Example.** Bob has a GitHub token. Alice's agent wants to post to GitHub. It uses Alice's GitHub token, not Bob's. Bob's token never comes near Alice's agent.

## Letting colleagues in — channels

A **channel** is a connection point. It places your agent onto a surface where colleagues work — a Slack channel, a Telegram chat. Pick the surface, connect your agent, and your teammates can now see the agent exists.

By default, seeing is all they can do. Watching is free. **Sending messages to the agent is not.**

To let a specific person send messages, you add them to the agent's access list. Only then can they interact with it. You decide who is on the list, and you can remove them.

> **Example.** Alice connects `my-researcher` to a Slack channel Bob is in. Bob can now read every exchange Alice has with the agent. He still can't message the agent — Alice hasn't added him. Once she does, he can. Even then, the agent is still Alice's. Bob is a guest.

## What happens when a colleague uses it?

This is the important part. When Bob (a guest Alice added) messages Alice's agent, the agent acts as **Bob**, not as Alice, for that turn:

- Any pull request the agent opens is authored by Bob.
- Any usage cost is billed to Bob.
- Any rate limits hit are Bob's limits.
- Any audit log shows Bob took the action.

Platform achieves this by starting a short-lived process for Bob's turn. That process carries Bob's identity and Bob's credentials. When the turn ends, the process shuts down. Alice's main process — the one that normally runs the agent — is not touched.

## The shared workspace

Every agent has a **workspace**: persistent storage that holds its files, notes, memory, and conversation history. The workspace survives restarts. Whichever process is running the agent at any given moment reads and writes the same workspace.

This matters when colleagues are involved. When Bob's short-lived process starts up to handle his turn, it reads **the same workspace** Alice's process uses. So Bob's turn has access to every file the agent has saved, every memory, every past conversation.

> **Example.** Alice shows the agent a confidential document. The agent reads it and remembers. Later, Bob asks a question. The agent may reference facts from Alice's document — because it's the same agent with the same memory, even though Bob never saw the document directly.

That's intentional. Sharing an agent means sharing its full context. If something shouldn't be shared, don't share *that agent* — create a separate one.

## Why one installation = one team

Everyone on one installation of Platform is aware the others exist. They can't see each other's agents (that's what this document is about), but they share the same identity system, the same credential gateway, and the same underlying infrastructure.

That's fine for one team that trusts its members. It is **not** appropriate for two teams that should be walled off from each other.

The rule is simple: **one installation of Platform per trust boundary.** One team, one installation. Two groups that need separation, two installations. Platform does not try to isolate mutually untrusted users inside a single installation today.

That may change in the future — the design leaves room for it. For now, the model is "shared installation within a trust boundary."

## References

- [Security model](security-model.md) — what keeps the agent from escaping or exfiltrating; the companion to this doc.
- Architecture deep-dives: [security-and-credentials](../architecture/security-and-credentials.md) — Keycloak identity, owner-labelled resources, the credential gateway, foreign-replier forks · [channels](../architecture/channels.md) — Slack and Telegram adapters, identity linking, per-thread access control · [agent-lifecycle](../architecture/agent-lifecycle.md) — per-turn fork pods that run as the colleague · [persistence](../architecture/persistence.md) — the shared workspace and what it means for cross-turn context.
- [Ubiquitous language](../../tseng/vocabulary.md) — canonical definitions for *channel*, *instance*, *fork*, *foreign replier*.
