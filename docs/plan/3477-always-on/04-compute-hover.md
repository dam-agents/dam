# 04 — Always-on hover in Compute Resources

**Part of:** Always-on — see [README](./README.md)

## Context

Hovering an agent's segment in the Compute resources graph shows whether that agent is
always-on and links to its Configure page — the graph is where a user wonders why compute is
held, so the answer and the fix live on the hover.

## Implementation plan

1. `packages/ui/src/modules/budgets/lib/slots.ts`: extend the held `ComputeSegment` variant
   with `alwaysOn: boolean` (from `agent.hibernationTimeoutMin === 0` in `computeView`).
2. `packages/ui/src/modules/budgets/components/slot-bar.tsx`: allow rich tooltip content — add
   an optional `content?: (segment: ComputeSegment) => ReactNode` prop used for held segments
   (falls back to `label`; `label` keeps feeding `aria-label`, extended with ", always on" so
   the state is not pointer-only). Radix tooltip content is hoverable by default, so a link
   inside it is clickable; verify `disableHoverableContent` is not set on the shared `Tooltip`.
3. `packages/ui/src/modules/budgets/components/compute-usage.tsx`: build the hover card per the
   Figma frame — bold agent name with `({cpu} CPU · {memory} Gi)`, then for always-on agents the
   line "Always on — holds compute even while idle." and a **Manage** link that calls
   `navigateToSandboxHome(agent.id)` from the store (`useStore`), landing on Agent Setup.
   Non-always-on agents keep name + size only.
4. `ComputeUsage` renders on Home (`home-view.tsx`) and anywhere `ComputeUsageCard` is used —
   the change is internal to the widget, call sites stay untouched.

Apply the `/react-ui-engineering` skill.

## Acceptance criteria

- [ ] Hovering a held segment shows the card; for an always-on agent it carries the always-on
      line and Manage; Manage navigates to that agent's Agent Setup.
- [ ] Available segments keep the plain text tooltip.
- [ ] Segment `aria-label` mentions always on for always-on agents.
- [ ] `mise run //packages/ui:check` and `mise run //packages/ui:test` pass
      (`slots.test.ts` exists — update expectations only if the segment shape change breaks it).

## Smoke test

On the dev server with one always-on agent running, hover its segment on Home's Compute
resources: card shows the always-on line; clicking Manage lands on the agent's Agent Setup.
Hover a non-always-on agent: name + size only.
