# Platform is multiplayer, not multitenant yet

> **TL;DR.** Platform is a shared platform for AI agents. Each agent belongs to one person — its owner. To let colleagues use an agent, the owner connects it to a shared surface (a Slack channel, a Telegram chat, …). That connection *is* the permission: anyone the surface admits can talk to the agent, and every turn runs as the agent — under the owner's credentials — with the sender attributed in the record.

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

A **channel** is a connection point. It places your agent onto a surface where colleagues work — a Slack channel, a Telegram chat. Pick the surface, connect your agent, and your teammates can talk to it.

The connection is the permission. There is no separate access list and no per-person mode to configure: lending your agent to a conversation is one deliberate decision, and everyone the surface itself admits is in. If a channel holds people you wouldn't lend the agent to, that's the signal to connect it somewhere smaller — or not at all.

> **Example.** Alice connects `my-researcher` to a Slack channel Bob is in. Bob can now read every exchange and message the agent himself. The agent is still Alice's — Bob drives it as a guest, in a place Alice chose.

## What happens when a colleague uses it?

This is the important part. When Bob messages Alice's agent, the agent acts as **itself** — which means under Alice's authority:

- The turn runs under the agent's own credentials, the ones Alice configured.
- Alice's approval prompts and network rules gate the turn exactly as they gate her own.
- The record still knows it was Bob: the security log attributes the turn to Bob's messenger identity, and the prompt is labelled with who spoke.

So sharing an agent is lending it. The owner answers for what the agent can reach; the log answers for who asked. There is no per-person credential switching — a colleague who needs to act under their *own* credentials needs their own agent.

## The shared workspace

Every agent has a **workspace**: persistent storage that holds its files, notes, memory, and conversation history. The workspace survives restarts, and every turn — the owner's, a colleague's, a scheduled one — reads and writes the same workspace.

> **Example.** Alice shows the agent a confidential document. The agent reads it and remembers. Later, Bob asks a question. The agent may reference facts from Alice's document — because it's the same agent with the same memory, even though Bob never saw the document directly.

That's intentional. Sharing an agent means sharing its full context. If something shouldn't be shared, don't share *that agent* — create a separate one.

## Why one installation = one team

Everyone on one installation of Platform is aware the others exist. They can't see each other's agents (that's what this document is about), but they share the same identity system, the same credential gateway, and the same underlying infrastructure.

That's fine for one team that trusts its members. It is **not** appropriate for two teams that should be walled off from each other.

The rule is simple: **one installation of Platform per trust boundary.** One team, one installation. Two groups that need separation, two installations. Platform does not try to isolate mutually untrusted users inside a single installation today.

That may change in the future — the design leaves room for it. For now, the model is "shared installation within a trust boundary."

## References

- [Security model](security-model.md) — what keeps the agent from escaping or exfiltrating; the companion to this doc.
- Architecture deep-dives: [security-and-credentials](../architecture/security-and-credentials.md) — Keycloak identity, owner-labelled resources, the credential gateway · [channels](../architecture/channels.md) — Slack and Telegram adapters, bindings, identity linking · [persistence](../architecture/persistence.md) — the shared workspace and what it means for cross-turn context.
- [Ubiquitous language](../ubiquitous-language.md) — canonical definitions for *channel*, *channel binding*, *shared access*.
