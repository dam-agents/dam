# 01 — Lifecycle option cards on Configure

**Part of:** Always-on — see [README](./README.md)

## Context

Replace the numeric hibernation-timeout field in Agent Setup with a two-card Lifecycle selector.
This slice builds the shared `LifecycleField` component the create flow (02) reuses.

## Implementation plan

1. New `packages/ui/src/modules/sandboxes/components/lifecycle-field.tsx`:
   - Props: `value: number` (`hibernationTimeoutMin`, 0 = always-on), `onChange(next: number)`,
     `size?: { cpu?: string; memory?: string }`, `disabled?: boolean`.
   - Two selectable cards side by side (grid, `role="radiogroup"` semantics): **Hibernate when
     idle** — "Requires time to start. Frees compute when not in use." (Carbon `Time` icon) and
     **Always on** — "Instant response (never idles). Always reserves compute." (Carbon `Power`
     icon). Selected card gets the emphasized border per the Figma frame.
   - Hibernate selected → a `minutes of inactivity` number input below (default 60). Keep the
     last hibernate minutes in local state so switching Always on → Hibernate restores it.
   - Typing `0` into the minutes input flips the selection to Always on (the input itself is
     `min={1}`); the flip is the only way the field emits `0`.
   - Always on selected → helper line "Reserves {cpu} CPU and {memory} memory against your
     budget while idle." formatted from `size` via `formatCores`/`formatGi`
     (`packages/ui/src/modules/budgets/lib/format.ts`) after `sizeInMi`
     (`packages/ui/src/modules/budgets/lib/slots.ts`). Unparsable/missing size → "Reserves its
     compute against your budget while idle."
2. Wire into Agent Setup: in
   `packages/ui/src/modules/sandboxes/components/sandbox-setup-section.tsx` replace
   `HibernationTimeoutField` with `LifecycleField` under the existing Lifecycle `SectionLabel`,
   bound through RHF `Controller` on `hibernationTimeoutMin` (form already carries the number:
   `use-sandbox-settings-form.ts`, `sandbox-settings-schema.ts` — keep `min(0)` there), passing
   `agent.size`.
3. Delete `packages/ui/src/modules/sandboxes/components/hibernation-timeout-field.tsx`; it has
   no other usage.
4. Keep the `hibernation-timeout-input` testid on the minutes input; add
   `lifecycle-hibernate` / `lifecycle-always-on` testids on the cards.

Apply the `/react-ui-engineering` skill.

## Acceptance criteria

- [ ] Agent Setup shows the two cards; the selected one reflects the agent's effective value
      (0 → Always on, otherwise Hibernate with the value in the input).
- [ ] Choosing Always on and saving sends `hibernationTimeoutMin: 0`; choosing Hibernate with N
      sends `N` (existing save path, unchanged).
- [ ] Typing 0 in the minutes input selects Always on instead of keeping a 0 window.
- [ ] The reserve line shows the agent's actual size.
- [ ] `mise run //packages/ui:check` and `mise run //packages/ui:test` pass.

## Smoke test

`mise run //packages/ui:check && mise run //packages/ui:test`, then on the dev server open an
agent's Agent Setup: flip between the cards, save Always on, reload — Always on stays selected
and the #3059 power menu shows Pause disabled for that agent.
