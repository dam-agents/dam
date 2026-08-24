# Public Agent Page

Last verified: 2026-08-24

## Overview

The **Public Agent Page** is the one Platform surface that renders for a visitor with no login. It exists because of a specific dead end: an Agent posts in a shared Slack conversation, someone who is not its owner clicks the link in the [Agent Footer](channels.md#the-agent-footer), and the platform told them the thing did not exist. It does exist — they hit an access boundary, and nothing on the page said so.

So the page is built as a **conversion surface, not an error page**. For most people in a shared conversation it is the first and only Platform screen they will ever see, so it names the Agent, names its owner, says what the install is, and invites the reader to create an Agent of their own. Treating it as an error state is the mistake it was created to fix.

It is reached from two places: the Agent Footer under every Slack post, and the authenticated chat route, which redirects here when a signed-in visitor turns out not to be able to read the Agent. That second path is what closes the boundary for signed-in non-owners, who would otherwise still hit the dead end. It has to leave the app by full navigation rather than an in-app route change: the public entry is chosen from the path during bootstrap, so a history push would keep rendering the authenticated tree and never reach this page.

## Trust boundary

The page is **unauthenticated and served from the app origin** — the same host as the rest of the UI, not the artifact share host.

The share host is the tempting answer and the wrong one. It exists for exactly one reason: user-generated content must never execute on the app origin ([artifact-library](artifact-library.md)). This page is platform chrome — first-party markup, no agent-authored bytes in it — so none of that rationale applies, and hosting a conversion surface on a deliberately-untrusted subdomain hands people a URL that reads as untrustworthy because it _is_ the untrusted one. "Put it on the share host, that's the public one" conflates _public_ with _untrusted_; the two boundaries are unrelated.

The page is rendered by the SPA rather than server-side, which puts the trust boundary **inside client bootstrap**: normal bootstrap ends in an unconditional redirect to Keycloak, so the public path has to be recognised and returned from before authentication runs. That carve-out is a security boundary, not a routing convenience — it is the one branch that reaches a render with no user — and it is pinned by specs asserting every authenticated path the matcher must refuse. A public entry that widened by accident would drop an anonymous visitor into the authenticated tree.

## Nobody is identified

Access tokens live in session storage, so a plain navigation carries **no credential** and there is no app-origin cookie. The api-server therefore cannot tell an owner from a stranger on this request, and the page **does not try**.

That is a deliberate ceiling, not a gap to close later. There is no auto-redirect for owners, because recovering identity on a navigation would mean a silent-auth round trip on every stranger's visit — cost and a Keycloak dependency on the one surface that must render for people who have no account. Instead the page offers the owner a link into the app and lets normal authentication happen when they take it.

The page therefore has exactly **two states**, chosen without reference to who is asking:

- **named** — the Agent exists and holds at least one Channel Binding: its name, its owner, the pitch, the calls to action.
- **generic** — everything else: the same page, minus the Agent's name and owner.

## What the page exposes

An Agent is named only when it holds **at least one Channel Binding**. Holding a binding is what makes an Agent's name shared information — its posts already carry that name into a conversation full of people — so the binding is the disclosure the page rides on rather than a new one.

Everything else renders the **generic page at HTTP 200**: an unknown id, a real Agent with no binding, and a deleted Agent are indistinguishable to the reader. Two properties follow, and both are the point:

- **The URL is not an oracle.** No status code, latency, or body difference tells a prober which Agent ids exist, so the page cannot be walked to enumerate the install.
- **A stale link still lands somewhere useful.** A link under a deleted Agent's old post degrades to the pitch instead of a 404.

Read responses are uncacheable, so nothing downstream can turn the generic answer into a stored one that later contradicts a named one.

**Accepted consequence: releasing a binding retroactively blanks every historical Slack link in that conversation.** The Agent's old posts keep their footers, but those links now render the generic page, because being named follows the binding as it stands _now_, not as it stood when the post was made. This is correct behaviour and it will be reported as a bug. Making it not happen means either keeping a name public after the binding that justified it is gone, or recording per-post disclosure state — the first breaks the rule above, the second buys very little.

## Read path

**Public reads never touch the K8s API.** An Agent's name lives on its Agent custom resource, so the naive implementation lets anyone with a shell drive control-plane reads at whatever rate they like, on the one endpoint with no principal behind it to rate-limit against.

Caching does not substitute for fixing this, and the reason is worth stating because it inverts the usual intuition: **Agent ids are unguessable, which cuts the wrong way.** Every probe of a random id is a distinct cache key and therefore a _guaranteed miss_. A cache in front of a read-through would pass essentially all hostile traffic through to the control plane while absorbing only the repeat views of genuinely shared links.

So the page reads an owner-agnostic **Postgres projection** of the Agent's name and owner, held by the Agents context. The binding check gates every read _before_ either the projection or K8s is consulted, so control-plane reads are bounded by the number of bound Agents rather than by request volume. The owner's **display name** is resolved from the identity directory for display, and a failed lookup omits the owner line rather than failing the page. It is a name and never the email: the identity directory holds a real mailbox, and this is the one page anyone holding a shared link can read, so an Agent whose owner has no name on record gets no owner line at all.

Three mechanisms keep the projection current, each with **one** job:

| Mechanism     | Job                                                                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lazy fill** | Fills a missing row on first page view, behind the binding check. This is the entire backfill story — there is no migration backfill and no boot walk, because an Agent nobody has ever looked up costs nothing to not have.      |
| **Saga**      | Keeps a row current as the Agent is created, updated, and deleted, and pre-warms it when an Agent is bound to a conversation, so the first click after a bind is already warm.                                                    |
| **Reconcile** | Periodically refreshes rows **that already exist**. It does not scan bindings looking for Agents to add — that is lazy fill's job. Its only purpose is catching a replica that died between the K8s write and the Postgres write. |

Reading them as interchangeable is the failure mode: if the reconcile grows a binding scan it becomes a fleet-wide walk of the control plane, which is the thing the projection exists to prevent.

**The usage-tracking `agents` table cannot serve this page.** It is the obvious-looking home — it already mirrors Agent ownership into Postgres — but it belongs to [usage-tracking](usage-tracking.md), whose premise is pseudonymized identifiers, so it hashes its owner column on write. A hash cannot be resolved back to a person, which is the one thing this page needs the owner column for. Extending that table for this would mean either storing the real identifier in a table whose contract says it holds none, or giving up naming the owner. The projection stores the real identifier instead, exactly as channel bindings already do ([persistence](persistence.md)).
