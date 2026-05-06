---
name: team-report
description: Generate a status report of what each team member is working on by querying the active GitHub Projects v2 board. Use this skill whenever the user asks for "team report", "team status", "team standup", "what's everyone working on", "who's blocked", "is the team active", or any cross-team activity check tied to GitHub. Flags members with no active ticket and active tickets that have gone stale (no commit activity in the last 48h).
---

# Team Report

Generate a status report from the active GitHub Project. For each team member, find their active ticket and check whether they have recent commit activity. Flag the gaps so the user can see at a glance who's parked and which tickets have stalled.

## Team

The team is fixed. Use exactly these GitHub handles:

```
JanPokorny, jezekra1, jjeliga, PetrBulanek, pilartomas, kapetr, Tomas2D, xjacka, tomkis, matoushavlena
```

## Default project

- Org: `dam-agents`
- Project number: `1` (name: `DAM`)
- Active = Status field equals `In Progress`

If the user names a different project, override these. If you're not sure which project is meant, ask before guessing — the team list is the same but the board may not be.

## Step 1 — Pull all In Progress items in one shot

Don't query per-member. Pull the whole board's In Progress items once, then filter locally.

```sh
gh api graphql -f query='
{
  organization(login: "dam-agents") {
    projectV2(number: 1) {
      title
      url
      items(first: 100) {
        nodes {
          fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { name }
          }
          content {
            __typename
            ... on Issue {
              number title url updatedAt
              repository { nameWithOwner }
              assignees(first: 10) { nodes { login } }
              closedByPullRequestsReferences(first: 10, includeClosedPrs: false) {
                nodes { number url repository { nameWithOwner } }
              }
              timelineItems(first: 50, itemTypes: [CONNECTED_EVENT, CROSS_REFERENCED_EVENT]) {
                nodes {
                  __typename
                  ... on ConnectedEvent { source { __typename ... on PullRequest { number url state repository { nameWithOwner } } } }
                  ... on CrossReferencedEvent { source { __typename ... on PullRequest { number url state repository { nameWithOwner } } } }
                }
              }
            }
            ... on PullRequest {
              number title url updatedAt state
              repository { nameWithOwner }
              assignees(first: 10) { nodes { login } }
            }
          }
        }
      }
    }
  }
}'
```

Filter to `fieldValueByName.name == "In Progress"`. Keep the project `title` and `url` for the report header. Paginate via `pageInfo` if there are >100 items (rare).

The query intentionally pulls **two** PR-link sources because GitHub stores them inconsistently:
- `closedByPullRequestsReferences` — PRs that close the issue via "Closes #N".
- `timelineItems` (`CONNECTED_EVENT` / `CROSS_REFERENCED_EVENT`) — PRs that mention the issue or are linked via the dev panel without a closing keyword.

For each issue, build a deduped set of linked PRs (by `repo + number`) from both sources. Don't filter by PR state — even a recently merged PR is recent activity that should keep the ticket from being flagged stale.

## Step 2 — Match tickets to members

Walk the team list once. For each member, collect every In Progress item where the member appears in `content.assignees.nodes[].login`.

- 0 tickets → record as **no active ticket**.
- 1 ticket → normal case.
- 2+ tickets → list all of them; this isn't a problem, just visible.

A ticket can have multiple assignees; the same ticket can appear under several members. That's fine.

## Step 3 — Decide whether each ticket is stale

The user's definition: a ticket is stale when there has been **no commit activity in the last 48 hours**. The signal lives on the linked PR, not the issue (issue `updatedAt` changes when labels move, comments land, etc.).

Compute the cutoff once: `date -u -v-48H +%Y-%m-%dT%H:%M:%SZ` on macOS, or `date -u -d '48 hours ago' +%Y-%m-%dT%H:%M:%SZ` on Linux.

For each active ticket, in order:

1. **If the ticket is itself a PR** (`content.__typename == "PullRequest"`): fetch the latest commit on that PR.
2. **If the ticket is an Issue with linked PRs** (deduped from both sources above): fetch the latest commit across all of them and take the max timestamp.
3. **If the ticket is an Issue with no linked PR at all**: there can be no commit activity tied to this ticket. Mark stale with reason **"no linked PR"** so the user can see the workflow gap rather than assume the assignee is idle.

Latest-commit query for a PR:

```sh
gh api repos/<repo>/pulls/<num>/commits --jq '[.[].commit.committer.date] | max'
```

A ticket is **stale** when its latest linked-PR commit is older than the 48h cutoff (or no linked PR exists).

Run the per-PR commit lookups in parallel — usually under 20 active items. Either drive `xargs -P 8` or run them as background jobs in a small bash loop. Don't serialise the round-trips.

### Optional cross-check: assignee commit activity

When a ticket comes back stale or "no linked PR", spot-check whether the assignee is otherwise active in the org over the same window:

```sh
gh api search/commits -X GET \
  -f q="author:<login> org:dam-agents committer-date:>=<CUTOFF>" \
  -H "Accept: application/vnd.github.cloak-preview" \
  --jq '.total_count'
```

This isn't a stale/not-stale signal on the ticket — the ticket spec is unchanged — but it lets the report annotate "stale ticket, but assignee committed N times elsewhere in 48h" so the user can tell *unlinked work* apart from *no work*.

## Step 4 — Format the report

Lead with the flags — that's why the user ran this. Per-member detail only for members with an active ticket. No emojis. Times in UTC, plus a relative "Xh ago".

```markdown
# Team Report — <YYYY-MM-DD HH:MM UTC>

Project: [<project title>](<project url>)

## Summary
- Active tickets: <N>
- Members without an active ticket: <N> / 10
- Stale tickets: <N>

## Flags

### No active ticket
- @<login> — <N commits in last 48h elsewhere> | no recent activity
- @<login> — ...

### Stale tickets
- @<login> — [<repo>#<num> — <title>](<url>) — last commit <Xh ago>
- @<login> — [<repo>#<num> — <title>](<url>) — no linked PR (<N commits in last 48h elsewhere>)

## Active tickets

### @<login>
- [<repo>#<num> — <title>](<url>)
- Last commit: <ISO timestamp> (<Xh ago>) on PR #<N>
- State: ok | stale | no linked PR
```

Rules:
- Order members in the Flags sections by the Team list above (stable order beats alphabetical for a recurring report).
- Skip whole sections that are empty (omit the heading; don't print "(none)").
- For "no active ticket" members, append the org-wide commit count from the optional cross-check — distinguishes parked from working-without-a-ticket.
- "ok" only when there's a linked PR with a commit inside the 48h window. If the ticket is itself a PR, use that PR's last commit.
- One ticket per bullet line if a member has multiple.

## Why this shape

- One GraphQL request for the board, then parallel commit lookups, keeps the whole thing under ~15 seconds even on larger boards.
- Hardcoding the team list (in this skill) and the active-status definition (`In Progress`) is intentional — the user wants a fixed lens, not a configurable tool.
- Distinguishing **no linked PR** from **stale linked PR** matters: the first is a workflow gap (issue isn't connected to code yet), the second is genuine inactivity. Lumping them loses signal.
