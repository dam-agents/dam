# 02 — Coding agent setup page

**Depends on:** 01-scaffolding-experiment-kb
**Part of:** Separate creation flow for coding agents, experiments and knowledge bases — see [README](./README.md)

## Context

The third and largest page: `/coding-agents/new`. It adds the one section the other two flows do not have — the image choice — over the scaffolding slice 01 built. The prototype's first screenshot on the issue is the reference: Name, an IMAGE grid of harness cards, an "or use a custom image" divider with the custom card, then Provider and Connections.

Apply the `/react-ui-engineering` skill.

## Implementation plan

### 1. The page — `packages/ui/src/modules/agents/views/coding-agent-setup-view.tsx`

"Setup your coding agent" / "Name your agent, choose an image, select a provider, and add connections." Sections in that order, then **Create coding agent**.

Reuse the shell, the name, provider and connections sections from slice 01. Pass this page's own route as the OAuth return path.

### 2. The image section

Source the lists from `lib/image-catalogue.ts` — it already splits templates into `harnesses` and `preconfigured`, and already hides VM images unless the `vm-sandboxes` feature flag is on (read it with `useFeatures()`, as `sandbox-wizard-view.tsx` does).

- **Harnesses** first, in a two-column grid of `steps/harness-card.tsx`. Preselect `claude-code` on first mount when it is installed — do not hard-fail when it is not; a platform can ship without it.
- **Specialized** second, under its own `SectionLabel`, using `steps/workload-card.tsx` (which already renders the experimental badge). The prototype omits this group; it is a deliberate addition, because the chart ships seven of these enabled. When none are installed — as on a dev cluster with only `claude-code` and `mock` — render nothing rather than an empty group.
- A `setupNote` on the chosen template still has to reach the user: today `steps/setup-step.tsx` renders it as an info callout on step 2. Show it under the image grid once a template that has one is picked.

### 3. Custom image

Below the grid, after an "or use a custom image" divider: `steps/custom-image-card.tsx`, which already carries the private-registry disclosure through `components/registry-credential-section.tsx`. That disclosure stays exactly as it is — jenna asked for it explicitly on the issue.

Selecting a template clears the custom image and vice versa, as `sandbox-wizard-view.tsx` does today (`onPickTemplate` sets `customImage: ""`, `onCustomImageChange` sets `templateId: null`).

Carry over the registry rule the wizard enforces: partially filled credentials (one or two of server/username/password) block creation. `registryFilledCount` from `registry-credential-section.tsx` is the existing helper; the wizard's message points at step 1, so word this page's version for a single page.

### 4. Submit

Call `useCreateAgent()` with what `sandbox-wizard-view.tsx`'s `finish()` sends on its default branch, minus size: the name, `egressPreset: "trusted"`, either `image` (custom) or `templateId`, `appConnectionIds` (granted plus the provider's connection), and `registryCredential` only when all three fields are filled. On success `reset()`, clear the registry state, then `selectAgent(agent.id)`.

Creation must be disabled while a create is in flight and while the registry credential is partial.

### 5. Entry points

Point the "Create a coding agent" card in `modules/agents/components/welcome-entry-points.tsx`, the "Create coding agent" button on `coding-agents-view.tsx`, and Home's "Create sandbox" button in `list-view.tsx` at this page.

Leave `/sandboxes/new` alone — slice 03 redirects it.

## Acceptance criteria

- [ ] `mise run --force ui:check`, `--force ui:test` and `--force common:check:comment-types` pass.
- [ ] `/coding-agents/new` opens with a generated name, Claude Code selected, and LiteLLM selected where the user has one.
- [ ] Every installed harness appears; specialized images appear in their own labelled group with the experimental badge; a cluster with no specialized images shows no empty group.
- [ ] VM images appear only when the `vm-sandboxes` flag is on.
- [ ] Picking a template clears a typed custom image, and typing a custom image clears the template selection.
- [ ] A template's `setupNote` is shown when that template is chosen.
- [ ] Creating with a custom image plus complete private-registry credentials works; partial credentials block creation and say why.
- [ ] The created sandbox reaches running and opens in chat.
- [ ] All three coding-agent entry points reach this page.

## Smoke test

```sh
mise run --force ui:check
mise run --force ui:test
```

Then on the dev server at `localhost:5173`:

1. Reach the page from Home's card, from the Coding agents page button, and from Home's "Create sandbox" button.
2. Confirm the defaults, create with Claude Code, and confirm the sandbox reaches running and opens in chat.
3. Type a custom image and confirm the template selection clears; fill one registry field only and confirm creation is blocked with an explanation; complete the three and confirm it creates.
4. Note in your report whether specialized images could be exercised — the dev cluster installs only `claude-code` and `mock`, so the group is likely absent there, and its rendering is then verified only by the type-checker.

Run this, then print a short manual smoke-test guide so the user can confirm it by hand.
