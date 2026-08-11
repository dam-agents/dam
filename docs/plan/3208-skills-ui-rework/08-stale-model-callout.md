# 08 — Stale-model callout

**Depends on:** 01-page-shell-and-grouping
**Part of:** 3208 skills UI rework — see [README](./README.md)

## Context

The prototype's Stopped state carries an amber callout — the saved model is no longer
offered by the current provider — plus a warning dot on the `Sandbox Setup` nav item. The
signal shipped with #2654 but nothing renders it yet: `modules/agents/api/harness-config.ts`
computes `modelsPaired` (`snapshot.modelAtDiscovery === snapshot.model`), and the snapshot
carries the model and the discovered catalog. This slice is deliberately isolated so the
net-new UI cannot drag the visual rework.

## Implementation plan

Apply `/react-ui-engineering`.

1. Derive the verdict in one place (a small hook next to `harness-config.ts`'s consumers):
   stale ⇔ snapshot exists ∧ `modelsPaired` ∧ saved model missing from the snapshot's
   available models. `modelsPaired === false` proves nothing (the model changed after
   discovery) — render nothing in that case, per the contract comment on
   `modelAtDiscovery`.
2. Callout on the Skills page's stopped panel (above slice 06's snapshot notice), amber
   warn styling per prototype: `The saved model isn't offered by the current provider.`
   `This sandbox is set to {model}, which {provider} doesn't list. Chatting will fail
   until it's changed.` Model in mono; provider name from the sandbox's provider config.
   Action: `Start & fix` — the existing start action followed by navigation to the
   Sandbox Setup section (same navigation the surface already uses for
   `navigateToSandboxHome(agentId, …)`).
3. Nav dot: `components/sandbox-section-nav.tsx` accepts an optional warning marker per
   section; `use-section-summaries.ts` (or the nav's data source) sets it for
   `Sandbox Setup` when the same hook reports stale. Tooltip: `Saved model not offered by
   the current provider`. The Setup summary line may append ` · not offered` per the
   prototype.
4. Brand/provider strings: never hardcode a provider name — read it from the sandbox's
   configuration; fall back to provider-less copy (`…isn't offered by the current
   provider's model list.`) if no display name exists.

## Acceptance criteria

- [ ] A stopped sandbox whose snapshot model is absent from its discovered catalog (and
      `modelsPaired` true) shows the callout and the nav dot; both themes.
- [ ] `modelsPaired === false` or no snapshot → no callout, no dot.
- [ ] `Start & fix` starts the sandbox and lands on Sandbox Setup.
- [ ] Running sandboxes never show the callout on the Skills page.

## Smoke test

`mise run ui:check && mise run ui:test`. Dev cluster: stop a sandbox, then make its saved
model stale (edit the harness-config snapshot row in Postgres —
`psql -U platform -d platform` — to a model name outside `availableModels`, keeping
`modelAtDiscovery` equal to it). Reload: callout + dot appear; `Start & fix` starts the
sandbox and opens Sandbox Setup. Restore the row afterwards.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
