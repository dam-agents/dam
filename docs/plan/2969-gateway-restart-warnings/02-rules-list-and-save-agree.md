# 02 — Rules list and Save dialog agree

**Depends on:** 01-shared-promotion-predicate
**Part of:** Network gateway restart warnings — see [README](./README.md)

## Context

These two surfaces sit on the same screen and contradict each other. The rules list warns
from the draft row alone and treats any narrow rule on the host as "already inspected",
including a connection's own rule, which the server excludes. The Save dialog looks only
at the shapes of the staged additions — it never compares against the server's rule set,
and never looks at the staged deletions at all. Both now ask `gatewayRestartImpact` over
the same input, so they cannot disagree.

## Implementation plan

Apply [`/react-ui-engineering`](../../../.claude/skills/react-ui-engineering/SKILL.md).

### Rules editor — [`agent-egress-editor.tsx`](../../../packages/ui/src/modules/egress-rules/components/agent-egress-editor.tsx)

1. Replace `draftNeedsMitm` / `draftRequiresGatewayRestart` (lines ~89–100) with a
   `gatewayRestartImpact` call. `current` is `serverRules`. The pending set is the staged
   adds plus the draft row, minus the staged deletes:

   - draft row → `{ ...splitHostPort(draft.host.trim()), method, pathPattern, source: "manual" }`
   - staged adds → same mapping over `staged.pendingAdds`
   - `removeIds` → `[...staged.pendingDeletes]`

   Pass `source: "manual"` on every pending add. The source decides the connection
   exclusion, so an add carrying the wrong source silently re-creates case 6.

2. The inline warning under the Add-rule row (line ~305) renders from that impact and
   names the hosts. It must cover both directions — the draft can now *demote* nothing on
   its own, but the staged-delete set can, so the warning reflects the whole pending state,
   not just the draft.

3. Live mode (`stagedMode === false`):
   - **Add** (line ~121): swap `window.confirm` for the store's `showConfirm` — the same
     dialog the settings Save uses, so the two read identically. Show it only when the
     impact says restart.
   - **Revoke** (`onRowDeleteClick`, line ~160): today it fires `revokeRule.mutate`
     immediately. Compute the impact of `{ removeIds: [rule.id] }` and confirm first when
     it demotes. This is repro row 5.

4. Staged mode: mark a row whose staged deletion demotes its host, so Save's dialog is not
   a surprise. Keep it consistent with the existing pending-delete styling.

### Settings Save — [`use-sandbox-settings-save.ts`](../../../packages/ui/src/modules/sandboxes/hooks/use-sandbox-settings-save.ts)

5. Replace the `gatewayRestartHosts` filter (lines 61–68) with `gatewayRestartImpact` over
   `serverRules` + `net.pendingAdds` − `net.pendingDeletes`. The hook does not have the
   rule list today: call `useEgressRulesForAgent(agentId)` — TanStack Query serves it from
   the cache the editor already populated, so this costs no extra request.

   **Ask the function twice.** Save applies every delete, then every add, and the server
   rewrites the projection after each one. A Save that swaps the last narrowing rule on a
   host (delete `/v1/*`, add `/v2/*`) nets to no change, yet the host demotes and re-promotes
   mid-save — measured on the cluster as two gateway pod-template writes. Since the rules
   list has no edit button, that swap *is* the normal way to change a path, so it must warn.
   `stagedGatewayRestart` in [`gateway-restart.ts`](../../../packages/ui/src/modules/egress-rules/gateway-restart.ts)
   runs the shared predicate over the deletes-only state and over the full change, and warns
   if either restarts. The contract function stays a pure before/after set diff.

6. The dialog names what changes in each direction, and does not appear when
   `willRestart` is false. Keep the existing title and `confirmLabel` shape; keep it
   before the hibernation and size confirms, as now.

7. Preset changes stay out of this: `applyPreset` does not touch the projection, and
   preset rules never promote. Do not add them to the impact input.

### Copy

Say the **gateway** restarts and the **sandbox keeps running**. Promotion: the gateway
starts inspecting requests to the host. Demotion: it stops inspecting them. Both interrupt
outbound requests for ~5–15s.

## Acceptance criteria

- [ ] The rules list and the Save dialog give the same answer for the same pending change,
      in both directions.
- [ ] A second narrowing rule on an already-narrowed host warns on neither surface.
- [ ] A narrowing rule on `*` warns on neither surface.
- [ ] A narrowing rule on a host narrowed only by a connection warns on both.
- [ ] Revoking the last narrowing rule on a host confirms first — live and staged.
- [ ] A path rule on a host promoted by a port-only rule warns on neither surface.
- [ ] Live add and live revoke use the store's confirm dialog, not `window.confirm`.
- [ ] `mise run check`, `mise run test` and `mise run common:check:comment-types` pass.

## Smoke test

Walk rows 1–6 of the table in the [README](./README.md) in the UI at
`http://localhost:4444` (login `dev`/`dev`), watching the gateway pod UID with the observe
command in the README. For each row, the warning shown must match the measured column.

Row 6 needs a connection whose host is path-scoped. The OpenAI template is the cheapest —
it scopes `api.openai.com` to `/v1/*` and takes a plain string as its key, so no OAuth is
needed:

```bash
curl -s -X POST -H "Authorization: Bearer $TOK" -H 'content-type: application/json' 'http://localhost:4444/api/trpc/connections.create' -d '{"templateId":"openai","name":"smoke-2969","authKind":"header","value":"sk-not-a-real-key"}'
```

Grant it to the sandbox, confirm `spec.l7Hosts` stays empty, then add a manual
`api.openai.com` `/v2/*` rule — the list must warn, and the pod UID must change. Delete the
connection afterwards.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
user can confirm it by hand.
