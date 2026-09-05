# Topping up the leads agenda from the knowledge base

The tracker (`leads-items.md`) is **the** source. These fill the rest of the five
and catch things live for the leads that nobody raised with me.

**There is no leads transcript and there never will be** — the leads don't record
the meeting (Jenna, 2026-08-26). Nothing below is a substitute for the tracker;
don't go hunting for a `dam-leads` touchpoint file.

**Label these as mine.** A knowledge-base find is my suggestion; a tracked item is
a lead's own ask. Jenna should be able to tell which is which at a glance.

## Hosts — not interchangeable

- **`github.ibm.com`** — `dam-agents/strategy`, the knowledge base. **Slow, ~20s
  per call — use generous timeouts.** A `401` on `/user` is expected and harmless.
- **`github.com`** — `dam-agents/dam`, the project repo. Issues, assignees.

## 1. The internal Slack sweeps — channel traffic, not a transcript

The **internal Slack sweep** covers `#dam-leads` alongside the other internal
channels and carries a `## #dam-leads` section when the channel had traffic. It
records what was *written in the channel* — useful for threads that died without a
reply, and for anything raised before I was added. It is **not** a record of the
meeting itself; nothing records that.

```bash
gh --hostname github.ibm.com api \
  /repos/dam-agents/strategy/git/trees/HEAD?recursive=1 \
  --jq '.tree[].path' | grep dam-internal-slack-sweep | sort | tail -3
```

Read the latest few and pull the `#dam-leads` section:

```bash
gh --hostname github.ibm.com api \
  /repos/dam-agents/strategy/contents/<path> --jq '.content' | base64 -d
```

These are written under the **discretion rule** (strategy, access policy and
direction only — see the `dam-leads-track` skill), so what they contain is safe to draft
from. Prefer: unresolved decisions, sponsor rulings, anything left unanswered.

**Unanswered questions are the best leads material** — the sweeps are explicit
about how long something has gone without a reply (*"nobody replied for the
remaining 22 hours"*), and a question nobody answered in channel is exactly what a
leadership meeting is for.

## 2. `feedback.md` — the open decisions

`T`-IDs are open decisions; that is what this meeting decides. The **"Closest to"**
column names a person — the best single source for a suggested speaker.

Prefer T-IDs whose `Where` column includes `#dam-leads`, then ones asked *of* a
lead by name, then ones blocking a population of users.

## 3. `insights.md` — direction and sponsor rulings

`S`-IDs with `#dam-leads` in the channel column, and anything marked `proposed`
with no owner, no date and no issue. Those are the ones that need this room.

```bash
gh --hostname github.ibm.com api \
  /repos/dam-agents/strategy/contents/insights.md --jq '.content' | base64 -d \
  > /tmp/insights.md
grep -n "dam-leads" /tmp/insights.md
```

Also `next-steps.md` and `plan.md` for per-team owners and booked calls, and
`teams/roster.md` for who leads what.

## 4. The project issues — for owners and state

```bash
gh --hostname github.com api /repos/dam-agents/dam/issues/<n> \
  --jq '{number, title, state, user: .user.login, assignees: [.assignees[].login]}'
```

Check state before proposing — `dam#3454` was closed two hours after a core
weekly, which changed what should have been said about it.

## 5. Slack handles — Airtable, read only

Same source as the core meeting. Access is via the platform connection
`dam-airtables-readonly` (`conn-a8e19598aa03`, host `api.airtable.com`). **There
is no token in the pod** — the egress proxy injects the auth header, so a plain
`curl` just works. Confirm with `listConnections()` from
`/usr/local/lib/driver-sdk.mjs` if in doubt.

`w3` table of the `DAM` base — base `appYns1F3DZPVq8gm`, table `tbl4enUWFROx8gxXa`.
Fields: `Name`, `Slack ID`, `Slack username`.

```bash
curl -s --max-time 30 -G \
  'https://api.airtable.com/v0/appYns1F3DZPVq8gm/tbl4enUWFROx8gxXa' \
  --data-urlencode "filterByFormula=SEARCH('<fragment>',{Name})" \
  --data-urlencode "fields[]=Name" \
  --data-urlencode "fields[]=Slack ID" \
  --data-urlencode "fields[]=Slack username" | jq -c '.records[].fields'
```

- Mention with the **`Slack ID`**, never the username.
- Airtable holds **accented spellings** ("Tomáš Dvořák", "Jan Pokorný") — search a
  fragment (`Dvo`, `Pokor`), because an ASCII full name returns nothing.
- **Never write to these tables.** They are production access control.

Verified 2026-08-26 for the leads: Jenna Winkler `U02JVA1K5K8`, Darrell Reimer
`W4R95LH37`, Matous Havlena `WMB8M03CP`, Chris Milite `W4QJR5YSX`, Sarah Miller
`W4BQ82Y0J`, Helen Stanton `W3HV828GN`. Re-resolve rather than trusting this list —
it is a convenience, not a cache.

If a handle cannot be resolved, use the plain name and flag the unresolved mention
to Jenna. An `@` that pings the wrong person is worse than an untagged name.
