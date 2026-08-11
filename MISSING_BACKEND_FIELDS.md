# Missing Backend Fields

Fields required by the home page redesign that are not yet available from the API.
Each STUB in the frontend mocks these with fixture data until the backend exposes them.

## `home.blockedItems` (unified blocked feed)

The frontend defines a `BlockedItem` type that merges several sources:

| Field | Source today | Notes |
|-------|-------------|-------|
| `blockedAt` | Only approvals have `createdAt`; run failures, connection errors, budget stops, and agent errors have no timestamp exposed via tRPC | Need a unified "blocked since" timestamp per item |
| `runId` / `runName` | Not surfaced for approvals; schedule runs have it but not on the approval object | Needed to show which run the agent was executing when it blocked |
| `intent` | Not available — would need agent context or session summary | Human-readable sentence: what the agent was trying to do |
| `seenAt` | No seen/read state exists | Per-user "mark as seen" timestamp; drives the digest model |
| `holdsComputeSlot` | Inferable from agent state but not explicit on the blocked item | Boolean: is this item actively consuming a compute slot while blocked? |
| `limitAmount` / `spentAmount` | Budget info exists on the agent but not structured on a blocked item | For budget_stop items: the cap and actual spend as numbers |
| `ranForMs` | Not available on failed run records | For run_failure items: how long the run executed before failing |

## `home.digestSince` (last-visit tracking)

| Field | Source today | Notes |
|-------|-------------|-------|
| `digestSince` | No server-side last-visit timestamp | ISO8601 of user's last meaningful visit; drives "Since X" header |
| Per-user seen state | No read/unread model | Needed for "Mark all seen", unseen counts, digest window |

## `home.readyItems` (ready for review)

| Field | Source today | Notes |
|-------|-------------|-------|
| Entire endpoint | Does not exist | Returns PRs ready for review, artifacts completed, suggestions, finished runs |
| `completedAt` | Partially available per-resource | Unified completion timestamp |
| `actionUrl` | Not available | Deep link to the relevant resource |

## `home.resultItems` (experiment results)

| Field | Source today | Notes |
|-------|-------------|-------|
| `baseline` / `result` | Experiment metrics exist but not aggregated into a feed | Need structured metric comparison per completed experiment |
| `isSignificant` | Not computed server-side | Whether delta exceeds `RESULT_SIGNIFICANT_DELTA` threshold |

## `home.learningItems` (knowledge base discoveries)

| Field | Source today | Notes |
|-------|-------------|-------|
| Entire endpoint | Does not exist | Returns new knowledge surfaced by KB agents since digestSince |
| `summary` | Would need LLM-generated summary of indexed content | Short natural language summary |
| `sourceCount` | Derivable from indexing logs | Number of sources that contributed to this learning |

## `home.runningItems` (currently executing)

| Field | Source today | Notes |
|-------|-------------|-------|
| `task` | Not available — would need current session/run context | Human-readable description of what the agent is doing right now |
| `startedAt` | Partially available from run/session start | When the current task began |

## `home.digestSummary` (header counts)

| Field | Source today | Notes |
|-------|-------------|-------|
| Entire endpoint | Does not exist | Aggregate counts since digestSince: blocked, completed, newArtifacts, newLearnings, running |

## Unified endpoint shape

The frontend expects a single query (`home.blockedItems`) that returns all blocked items
across approval requests, run failures, connection errors, budget stops, and agent errors
as a flat ranked list. Today these are separate queries/subscriptions.
