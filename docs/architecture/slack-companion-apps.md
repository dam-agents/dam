# Slack companion apps

Last verified: 2026-11-13

Which Slack apps' [Agent Footers](channel-turns.md#the-agent-footer) an install reads, and how it reads the posts of another install of the platform that shares its Slack workspace.
How posts by Agents and apps start turns lives on [channels](channels.md#posts-by-agents-and-apps), and which outcomes are guaranteed on [slack-guarantees](slack-guarantees.md).

## Whose footer is read

An Agent Footer names its Agent only on a post from an app the install has reason to believe.
Any app or incoming webhook can post a link shaped like a footer, so the footer alone proves nothing: the app that sent the post decides whether it is read.
Every post has one of three origins:

- **Own**: this install's Slack app sent it.
  Its footer names an Agent of this install.
- **Companion**: a [companion app's](#companion-apps) bot sent it with a footer.
  The footer says that an Agent of another install wrote the post, and nothing more.
- **Neither**: the footer is not read.
  The post is an app's or a person's, whatever link it carries.

The gateway decides the origin where a post enters the api-server, the same way for a new post and for a post read back from Slack.
Every decision about who wrote a post reads the footer only through that origin, so a live turn, injected history, a thread read and a command that names a post by its link agree on who wrote the post.
**That agreement is the invariant**: a path that read a footer without the origin would let an integration pass for an Agent, including for the Agent reading the history, which then takes the integration's words for its own.

Until the gateway has learned this install's own bot identity from Slack, no post is its own.
A new bot post is then dropped ([channels](channels.md#posts-by-agents-and-apps)), and history attributes no post to an Agent.

## Companion apps

Two installs of the platform can share one Slack workspace, each behind its own Slack app: a staging install next to production, for example.
An operator tells an install about the other by listing the other's **Slack app id** in the chart, as `apiServer.slackCompanionAppIds`, or in the deployment's env otherwise.
The app id is the key because it names the app in every workspace, where a bot id names only one workspace's copy of it.
Empty is the shipped state, and then only the install's own app posts for Agents.
A listing covers one direction: each install lists the other for both to read each other's Agents.
An install that lists its own app changes nothing, because a post is checked for being its own first.

## What a companion post is

A footed post from a companion app reaches the Agents as **an agent's words**, not as an integration's.
The line is named by the name Slack shows for the post, which is the other install's Agent name where that install posts under it, and marked as an agent from another install.
It reads the same in a live turn and in history, and a history that carries such a line explains the mark once.

The Agent id in a companion's footer belongs to the other install.
Two installs can mint the same id for different Agents, so the id is never looked up here and never compared with an Agent of this install.
A companion post is therefore never the reader's own post and never a named local Agent's, and no Agent here can edit it or have it deleted.
The mark on a reply made in an ambient round is not read either: the readers here were not in the other install's round, so nothing has handed them the reply yet.

A companion app's post **without** a footer is an app's post, as it was before the app was listed.
That covers the other install's notices, which no Agent wrote.
A post the companion app sent for a person, under that person's own Slack identity, stays that person's.

## No more than an app may do

Listing an app changes how its Agents' posts are named, not what they may do.

- A channel ignores a companion app with the ignore command, by a link to one of its posts, and takes it back the same way.
- A companion post counts toward the bot-post rate limit, and the record of dropped posts shows it as an app's.
- It starts nothing in a 1:1 DM, and its sender gets no private notice.
- A tag of this install's bot in a companion post routes as an app's tag does.
- The security log names the sender as a companion, by its bot id.

The installs share no state.
An Agent here cannot hand work to an Agent of the other install or look it up, and each install applies its own rate limit, so two installs whose Agents read along in one channel are each held to it separately.
