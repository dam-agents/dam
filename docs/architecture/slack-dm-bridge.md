# The Slack DM Bridge

Last verified: 2026-11-10

How the platform pairs an owner's Slack account with their own DAM account so that one of their Agents can reach them in a 1:1 DM with the bot, and can be asked to act from there.
Bindings, DMs and turns are [channels](channels.md); what is guaranteed in Slack is [slack-guarantees](slack-guarantees.md); threads a Session owns are [slack-threads](slack-threads.md).

## Why it exists

A 1:1 DM with the bot is an ordinary Slack conversation, so binding an Agent to it is what makes two-way work possible there: a plain message becomes a turn, and the Agent posts its results back.
What is missing without the Bridge is the *choice* of that conversation: someone would have to know the DM's id and connect it from the platform, which an owner being offered results by their own Agent never does.
So the Bridge finds the owner's Slack account itself, proves the conversation is theirs alone, and binds it — silently, because the trust it rests on is the operator's rather than a click.

## The trust it rests on

It is **dark by default**: an operator names the Slack workspaces whose mailboxes they vouch for, and nothing pairs until they do ([configuration](#configuration)).
Those workspaces, and only those, are ever searched, and only while each is installed and active.
Slack reports no single "trusted" flag on a person, so the pairing refuses every way someone can stand outside a workspace's own membership: a deleted account, a bot, an app user, a guest, a Slack Connect person, a Grid stranger, or anyone belonging to another team.
A paid Slack plan lets an admin set a member's address without verifying it, and a mailbox can be re-assigned after someone leaves, which is why the address must also be the owner's **verified** one and why a mailbox alone is never proof of a person.

Two facts are the reason this is not open enrolment:

- An owner's verified mailbox comes from the identity provider, and only when that provider says the address is verified on an enabled user; a directory that cannot answer pairs nobody.
- What a pairing grants is large: whoever types in a bound 1:1 DM drives the Agent under the owner's credentials, and the same link routes platform notices to that person.

## Readiness

`status` answers, for one owner, one of four things, and sends nothing:

- **off** — the install trusts no workspace for pairing, or configures no Slack app.
- **linked** — a proven link already exists in a trusted workspace that grants what the Bridge needs, so a connect needs no lookup.
- **pairable** — the owner's verified mailbox matches exactly one person, an ordinary member, in the first trusted workspace that grants the scopes.
- **unavailable**, with the reason: no trusted workspace is active, the workspace withholds a scope, the mailbox is missing or unverified, or no account there has it.

A workspace's granted set decides readiness from what Slack actually reports.
An unknown grant set is not a grant: the features that read a scope for a partial answer treat "unknown" as *granted*, and the Bridge must not.

## Connecting

A connect is the owner asking for one of **their own** Agents to be bound to their own DM, so an Agent the caller does not own is refused before anything is looked up.
The conversation is proven before any state is written: opening the DM must yield a 1:1 with the matched person, so a group DM, or a DM with somebody else, is refused with nothing linked and nothing bound.
Then the pairing writes its link, then the Agent is bound, then one hello is posted.

- **An email link inserts and nothing more.** It is written only when that Slack user has no link at all, and it never moves an existing one, so a Slack account already linked to a different person refuses the connect and is left exactly as it was.
- **A proven link wins.** A Keycloak sign-in keeps its overwrite and marks the link proven, which is what a later revoke then leaves alone.
- **The DM's default is never replaced.** An Agent that finds the DM already defaulted to another binds beside it, and the hello says to start a message with its name.
- **A repeated connect is a no-op.** An Agent already bound there is reported as such, and nothing is written or posted.

The hello is the consent copy: it names the Agent and the brand, says what it will send there, says that a message there can ask it to act on the owner's account, and names the in-chat command that undoes it.

Failures are reported as far as they got, never compensated: a step that fails leaves the link or the binding that already existed, because both may predate the Bridge.

## Revoking

`disconnect`, from the CLI or the tRPC surface, releases that Agent's binding on the owner's DM and the threads its Sessions owned there, and then removes the email link — but only once nothing is bound in that DM any more.
The in-chat unbind in that DM does the same, since a binding the person released must not keep delivering or answering.
A proven link stays, an email pairing in another trusted workspace stays, and every unrelated binding stays.
A pairing therefore narrows what a revoke deletes, which is why the link records how it was made: `oauth` for a sign-in, `email` for the Bridge ([persistence](persistence.md)).

## Configuration

An operator lists the trusted Slack workspaces as `apiServer.slackEmailPairingWorkspaces` in the chart, or the deployment's env otherwise; empty is the shipped state and means nothing pairs.
Each entry is a Slack workspace (team) id, and the list's order is the order the pairing searches them.

## Persistence touchpoints

- The link is an `identity_links` row with its source, the only place the pair's origin is recorded.
- The DM binding is an ordinary channel binding, an Agent against a conversation id, with the DM's default flag the bridge binding never steals.
- The threads the Agent's Sessions own there are the ordinary owned-thread records, released when the binding goes.
