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
Membership is never inferred from the workspace the lookup asked about: Slack's own attribution must name it, or the organization's list of the person's workspaces must contain it, and an answer that leaves either out is unknown and refused.
The organization the install recorded and the one Slack reports must also agree, so a person of a foreign organization, an enterprise guest, or a Grid identity the organization does not place in that workspace is refused; when either side cannot name its organization, the pairing refuses rather than assume a standalone workspace.
A paid Slack plan lets an admin set a member's address without verifying it, and a mailbox can be re-assigned after someone leaves, which is why the address must also be the owner's **verified** one and why a mailbox alone is never proof of a person.

Two facts are the reason this is not open enrolment:

- An owner's verified mailbox comes from the identity provider, and only when that provider says the address is verified on a user it calls enabled; a flag it leaves out, a field of another shape, or a directory that cannot answer pairs nobody.
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
Then the whole settle is written in one transaction — the link it found, the binding, the greeting's claim and the Bridge's own record — so a concurrent connect or a Keycloak sign-in cannot swap the owner or greet twice, and a later step that fails leaves nothing half-written.

- **An email link inserts and nothing more.** It is written only when that Slack user has no link at all, and it never moves an existing one, so a Slack account already linked to a different person, or in another workspace, refuses the connect and is left exactly as it was.
- **A proven link wins.** A Keycloak sign-in keeps its overwrite and marks the link proven, which is what a later revoke then leaves alone.
- **The DM's default is never replaced.** An Agent that finds the DM already defaulted to another binds beside it, and the hello says to start a message with its name.
- **One greeting, ever.** The record claims the greeting before posting it, so a second connect — or a second connect running at the same time — reports the same destination and posts nothing; a greeting that failed is cleared, and the next connect tries it again.

The hello is the consent copy: it names the Agent and the brand, says what it will send there, says that a message there can ask it to act on the owner's account, and names the in-chat command that undoes it — qualified by the Agent's name where another Agent shares the DM, since the bare command would be refused as ambiguous.

Failures are reported as far as they got, never compensated: a refusal names the destination and whether the link and the binding it found already existed, and nothing is deleted to undo a step that failed, because both may predate the Bridge.

## Revoking

A revoke works from the Bridge's own record, never from today's bindings and links: the record names the Agent, the workspace, the DM and the person it settled, so a revoke still finishes after a logout removed the link or a failed step removed the binding, and it asks Slack nothing.
It marks the record `revoking` first, which is what closes the DM immediately, and only then releases the binding, the threads the Agent's Sessions owned there, and the email link — the link last, and only once nothing is bound in that exact DM.
A failure at any step leaves the record `revoking` and says the revoke is incomplete; the DM stays closed and running the revoke again finishes it.
When it is done the record says `revoked`, and a later connect of the same destination reopens it.

`disconnect`, from the CLI or the tRPC surface, does that for the caller's own pairings of that Agent; the in-chat unbind in the DM does the same, since a binding the person released must not keep delivering or answering, and it acts only on a DM this Bridge recorded.
A proven link stays, an email pairing in another trusted workspace stays, and every unrelated binding stays.
A pairing therefore narrows what a revoke deletes, which is why the link records how it was made: `oauth` for a sign-in, `email` for the Bridge ([persistence](persistence.md)).

A closed DM is closed for the Agent, not for Slack: the worker admits no new message from it, drops a turn that was already queued when the revoke landed, drops a reply in a thread the Agent's Sessions owned there, and refuses any post or thread the Agent tries to start there — even where the owner's proven link and another connection would otherwise reach it.
Every other conversation the Agent is connected to, and the owner's own reach through a proven link, are untouched.

## Configuration

An operator lists the trusted Slack workspaces as `apiServer.slackEmailPairingWorkspaces` in the chart, or the deployment's env otherwise; empty is the shipped state and means nothing pairs.
Each entry is a Slack workspace (team) id, and the list's order is the order the pairing searches them.

## Persistence touchpoints

- The link is an `identity_links` row with its source, the only place the pair's origin is recorded.
- The DM binding is an ordinary channel binding, an Agent against a workspace and conversation, with the DM's default flag the bridge binding never steals.
- The threads the Agent's Sessions own there are the ordinary owned-thread records, released when the record is revoked.
- The Bridge's own record is one row per pairing: the Agent, the workspace, the DM, the person, its state and when it greeted.
  It exists so a revoke needs no live Slack answer and so a closed DM stops turns and delivery ([persistence](persistence.md)).
