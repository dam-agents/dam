# Agent Card Redesign — Scope

Branch: `design/agent-cards`
Cut from: `9eb9e2d8` on `design/packs-page`

## What this branch delivers

A redesigned `AgentRow` component that surfaces 7 facts per agent:
name, pack provenance, channels (Slack + Telegram), always-on status,
connections count, schedule count, and skill count. All states are
rendered in a dedicated card gallery page accessible from the mock
state bar.

## Buildable today vs needs server work

| Fact | Status | Notes |
|---|---|---|
| Name | Buildable today | `agent.name` — always present |
| Kind badge | Buildable today | `agentKindBadge(agent)` — knowledge-base, experiment |
| Slack channel count | Buildable today | `agent.channels.filter(c => c.type === "slack").length` |
| Telegram chat count | Buildable today | `agent.channels.filter(c => c.type === "telegram").length` |
| Connection count | Buildable today | Non-provider connections via `providerTypeForTemplateId` filter |
| Schedule count | Buildable today | `schedules.listForOwner` grouped by `agentId` |
| Never hibernates | Buildable today | `agent.hibernationTimeoutMin === 0` |
| Contribution failures | Buildable today | `agent.contributionFailures` array |
| Pack provenance | **Needs server work** | No durable field on `AgentView` — `applyPackTo` is transient navigation state |
| Skill count | **Needs server work** | Skills not reachable for hibernated agents (needs pod). Common case is "unknown" |
| Slack channel display names | **Needs server work** | Only raw `slackChannelId` available, no display names |

## Server asks

1. **Pack provenance field** — Add a persistent `packId` (or `createdFromPack`) field to `AgentView` so the card can show which pack created the agent. Currently `applyPackTo` is transient navigation state that doesn't survive a page refresh.

2. **Slack channel display names** — The card shows "2 channels" (count), not channel names, because only `slackChannelId` is available. If we want to show `#channel-name` in the future, the channels API needs to resolve display names.

3. **Skills snapshot on list payload** — Skills require a running pod (`ensureAgentReachable`). For the card to show skill counts, the server needs to snapshot installed/standalone counts when the agent is running and include them in the list payload. The common case for hibernated agents is "unknown" (skill chip omitted).

4. **`listForOwner` schedule limit** — `DEFAULT_LIMIT=200`, `MAX_LIMIT=500`. For users with many agents and many schedules, the current limit may truncate. The card counts schedules per agent from this list. If truncation is a concern, consider a per-agent count endpoint or raising the limit.

## Vocabulary decisions

### "Never hibernates" (not "always on")

The card displays `Never hibernates` when `hibernationTimeoutMin === 0`. This matches the existing label in `hibernation-timeout-field.tsx`. We explicitly chose NOT to use "always on" because:

- "Always on" implies the agent is currently running, which is false when the user has stopped it or it's over budget.
- "Never hibernates" describes the *configuration* (it won't auto-sleep), not the *current state*.
- The card already shows status (running/hibernated/error) via `StatusBadge` on the right rail — "Never hibernates" on row 3 is a separate configuration fact.

**Proposed ubiquitous-language entry:**

> **Never hibernates** — An agent whose `hibernationTimeoutMin` is 0. The agent will not
> auto-pause after inactivity. It may still be stopped by the user or paused by budget limits.
> Displayed as a configuration fact on the agent card, separate from the runtime status badge.

### Connection count excludes providers

The connection chip shows non-provider connections only (filtered via `providerTypeForTemplateId`). The provider connection (Anthropic, OpenAI, etc.) is already shown in the subtitle line as the provider name. Counting it again in the chip would be redundant and confusing — every agent has exactly one provider.

## Design decisions

### Pack badge meaning

The pack badge (`variant="muted"` with Package icon) indicates provenance: "this agent was created from the X pack." It does NOT mean the agent is currently in sync with the pack — configuration may have drifted. This is a deliberate choice: provenance is stable, sync status would require diffing current config against pack defaults.

### BindAgentRow stays deliberately reduced

`BindAgentRow` is a picker, not a scanner. It converges on shared identity (name + kind badge + description) but omits attachments, status, and the right rail. Changes made:
- Removed the monospace `templateId` line (was showing raw template IDs like "claude-code")
- Added kind badge (knowledge-base, experiment) to help users distinguish agent types during binding
- Kept description for context

The picker doesn't need schedule counts, connection counts, or status because the user is choosing *which* agent to bind, not monitoring its state.

### Zero-omission

When a count is 0, the chip is omitted entirely — no "0 channels", no empty chip. The attachments row itself is hidden when all counts are 0 (the `hasAttachments` gate). This keeps bare agents clean — just name + subtitle.

### Row 3 is configuration facts, not status

Row 3 (attachments row) shows what's *configured* on the agent: channels, connections, schedules, skills, never-hibernates. These are structural facts that don't change with the agent's runtime state. The runtime status (running, hibernated, error, over-budget) lives in the `StatusBadge` on the right rail. This separation prevents contradictions like "always on + hibernated" from appearing as a visual conflict.

## What didn't change

- **Row 2 (subtitle)**: Still `harness · provider` from `sandboxSubtitle()`. No changes.
- **Right rail**: `UpdateAvailableAction` + `StatusBadge` + overflow menu. No changes.
- **Temporary draw line**: Still rendered at the bottom when present. No changes.
- **Overflow menu actions**: Wake, Restart, Pause, Stop, Delete. No changes.
- **ContributionFailuresBadge**: Still on row 1 after name/kind/pack badges. No changes.

## Don't-implement list

- **Channel names** — Only counts. Display names need server work.
- **Skill names** — Only counts. Listing individual skills would require pod access.
- **Schedule names** — Only counts. Individual schedule details are in the configure view.
- **Pack sync status** — Only provenance. Diffing config vs pack defaults is out of scope.
- **Connection names** — Only counts. Individual connections are in the configure view.
- **Inline agent actions** — No quick-wake or quick-stop buttons on the card. Actions stay in the overflow menu.
- **Search/filter by attachment** — Out of scope for the card redesign.

## Files changed

| File | Change |
|---|---|
| `agents/components/agent-row.tsx` | Redesigned with 3-row layout, attachment chips |
| `agents/components/bind-agent-row.tsx` | Converged identity (name + kind badge + description), removed monospace templateId |
| `agents/hooks/use-agent-rows.ts` | Added schedule counts, non-provider connection counts |
| `mock/data/agent-card-fixtures.ts` | New: 12 fixture agents + 6 schedules + pack/skill maps |
| `mock/data/agent-card-gallery.tsx` | New: gallery page rendering all §5 states |
| `mock/mock-app-wrapper.tsx` | New: wrapper enabling card gallery from state bar |
| `mock/state-bar.tsx` | Added "Card gallery" screen to review index |
| `mock/data/agents.ts` | Added fixture agents to mock agent list |
| `mock/data/schedules.ts` | Added fixture schedules to mock schedule list |
| `mock/handlers.ts` | Added `schedules.listForOwner` mock handler |
| `main.tsx` | Updated mock mode to use `MockAppWrapper` |
| `__tests__/unit/agent-card-design.test.ts` | New: 33 §6 verification tests |
