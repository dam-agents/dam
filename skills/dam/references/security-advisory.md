# Security advisory

Read this before you give a DAM agent a credential, bind it to a chat, grant it a satellite, or widen what it reaches.
It tells you how to set an agent up so that its credentials stay out of reach and the user knows who can act as them.

## The rule

Anyone who can put words in front of a DAM agent can use everything the agent holds.
That is everyone who steers it:

- its owner, the user;
- its editors, who chat with it and start its sessions on the owner's connections;
- everyone in a Slack channel, group DM or Telegram group it is bound to;
- the viewers of an interactive page it shared, who send it prompts under the owner's grant;
- everyone who wrote what it reads: an issue, a pull request comment, a web page, a message in a channel it reads along in.

An agent can follow instructions hidden in what it reads (prompt injection), so the last group counts too.
Every one of these people can use every connection and satellite the agent holds.

So ask two questions about every credential.

### Is the secret outside the agent?

A connection keeps the secret outside the agent.
The agent's network gateway adds it to the agent's requests, and the agent sees only a placeholder.

A secret inside the agent can be read by the agent and by everyone who steers it.
That is a token in a file in its workspace, a value in `dam agent create --env`, a key in a prompt, or a file sent with `dam file put`.
It stays in the agent's files and session history, and it can be sent to any host the agent may reach.

So a secret always goes into a connection ([Secrets](../SKILL.md#secrets)), never into the agent.
If the user already put one inside an agent, tell them to revoke it where it was issued, store a new one in a connection, and delete the file that held it.

### Does the credential's identity match who steers the agent?

A credential acts as someone.
A connection made from a GitHub sign-in, a GitHub token, and most connections that sign in through a browser act as the user: what the agent does with them is the user's own action.
A GitHub App installation acts as its bot, `<app>[bot]`, and reaches only the repositories it is installed on.
In `dam connection list <agent> --json`, `check.account` names the account a checked connection acts as; when a connection has no check, ask the user whose account it is.

- While the user alone steers the agent, a connection that acts as the user is fine.
- Once others steer it, each of them acts as the user through it.
  Give the agent a connection with an identity of its own instead, such as a GitHub App, and scope it to what every one of them may do.

A model provider connection carries no identity, but everyone who steers the agent spends the user's money through it: set a limit with `dam spend limit set`.

## Check before you share

Run these checks before a command that lets more people steer an agent, gives it a credential, or widens what it reaches:

- `dam channel slack connect`, and `dam agent create --slack-channel`;
- `dam connection grant`, `dam agent create --connection`, and `dam agent create --kit` with a kit that asks for connections;
- `dam satellite grant`;
- `--full-access` on `dam connection connect` or `dam connection scope`;
- `dam approval approve` without `--once`.

The user adds editors and shares pages in the web app, not through you; when they tell you they did, or plan to, run the checks and tell them what it shares.

```sh
dam agent get my-agent --json
dam channel list my-agent --json
dam connection list my-agent --json
dam satellite list --json
```

- `access.editors` in `dam agent get` lists the agent's editors.
- `channels` in `dam channel list` lists the Slack conversations it is bound to.
  A Slack id that starts with `D` is a 1:1 DM; every other one, a group DM included, is shared, or becomes shared when someone joins it.
  The list does not tell a Telegram group from a 1:1 Telegram chat, so ask the user whether the agent is bound to a Telegram group.
- `dam connection list` lists what the agent holds, and whose account each connection acts as.
- `grantedAgentIds` in `dam satellite list` names the agents that reach each satellite.

`dam channel slack connect`, `dam connection grant`, `dam satellite grant` and `dam agent create --kit` also print a `warning:` on stderr when the change lets anyone besides the user use a connection or satellite, in every output mode: pass it on.

When the set-up is yours to choose, choose the safer one from the table below.
When the user asked for a set-up that the table calls bad, carry it out as asked, and in your answer say plainly:

- who can now act as the user, and through which connections or satellites;
- what that lets those people do;
- the safer set-up, and the commands that make it.

## Set-ups

| Set-up                                                                                           | Verdict                        | Why, and what to do instead                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A GitHub token in a file in the agent's workspace, in `--env`, or in a prompt                    | Bad                            | The secret is inside the agent. Store it in a connection; better, make a GitHub sign-in connection scoped to the repositories the agent needs.                                                                |
| An agent with a connection made from the user's GitHub sign-in, which only the user talks to     | Good                           | Only the user acts as the user.                                                                                                                                                                               |
| The same agent bound to the user's 1:1 DM with the bot                                           | Good                           | Still only the user steers it.                                                                                                                                                                                |
| The same agent bound to a private channel that only the user is in                               | Good while nobody else joins   | Whoever is invited later steers it as the user, and nobody asks the user again. Prefer a 1:1 DM.                                                                                                              |
| The same agent bound to a channel that others are in, a group DM, or a Telegram group            | Bad                            | Everyone there acts as the user on GitHub. Install a GitHub App on only the repositories the channel works on, connect it with `dam connection connect github-app`, grant that, and revoke the sign-in's one. |
| The same agent with editors, or with an interactive page shared with viewers                     | Bad                            | Editors and viewers use the owner's connections. Give it a GitHub App connection, as for a shared channel.                                                                                                    |
| An agent with a GitHub App connection, bound to a shared channel                                 | Good when scoped               | Everyone there gets what the app reaches, as the app's bot. Install the app on, and scope the connection to, only the repositories and permissions the channel needs.                                         |
| A satellite granted to an agent that anyone besides the user steers                              | Bad                            | Everyone who steers the agent runs tools on the user's machine. Grant satellites only to agents that only the user steers.                                                                                    |
| Ambient mode, or a schedule that reads public issues or web pages, on an agent with write access | Bad                            | Whoever writes what it reads can steer it. Give the connection read-only permissions, or a GitHub App scoped to what that work needs.                                                                         |
| A connection with `--full-access`                                                                | Avoid                          | It reaches every account and repository the sign-in reaches. Scope it to the repositories and permissions the agent needs.                                                                                    |
| A network request approved as a permanent rule                                                   | Avoid unless the user wants it | Every rule is one more host the agent can send data to. Prefer `--once`, and narrow rules to the host, method and path the agent needs.                                                                       |
| A model provider connection on an agent others steer                                             | Good with a limit              | They spend the user's money. Set a spend limit.                                                                                                                                                               |
| An agent created from a kit in a repository nobody on the server reviewed                        | Review first                   | Its setup runs with everything the agent is granted. Show the user what `dam kit show` prints, as [Starter kits](../SKILL.md#starter-kits) says.                                                              |
