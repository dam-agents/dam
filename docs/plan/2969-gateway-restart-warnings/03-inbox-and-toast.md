# 03 — Inbox and toast mark the restarting action

**Depends on:** 01-shared-promotion-predicate
**Part of:** Network gateway restart warnings — see [README](./README.md)

## Context

The approvals inbox writes rules but says nothing about restarts. "Allow permanently"
writes the held request's concrete method and path, which promotes the host and restarts
the gateway. The adjacent "Allow host" writes `*`/`*` and does not. Nothing marks the
difference, so the user learns the two are interchangeable. "Deny forever" writes the same
concrete shape as "Allow permanently" and restarts too — the issue does not mention this,
but `promotedHosts()` never looks at the verdict.

The same three actions appear on the egress approval toast, which is a separate component.
Both must be covered or the surfaces disagree again.

## Implementation plan

Apply [`/react-ui-engineering`](../../../.claude/skills/react-ui-engineering/SKILL.md).

1. Both components need the row's agent rules to answer the question. Call
   `useEgressRulesForAgent(row.agentId)` from
   [`../api/queries.js`](../../../packages/ui/src/modules/egress-rules/api/queries.ts) —
   TanStack Query deduplicates per `agentId`, so an inbox showing many rows of the same
   sandbox issues one request.

2. Derive the pending rule from the `ext_authz` payload, matching what the server writes
   in [`approvals-service.ts`](../../../packages/api-server/src/modules/approvals/services/approvals-service.ts):
   - **Allow permanently** and **Deny forever** → `{ host, method, pathPattern: path, source: "inbox" }`
   - **Allow host** → `{ host, method: "*", pathPattern: "*", source: "inbox" }`

   Feed each through `gatewayRestartImpact` as a single add against the agent's current
   rules. Non-`ext_authz` rows write no rule at all — they must never prompt.

3. Confirm before the mutation when the impact says restart, using the store's
   `showConfirm` — the same dialog slice 02 uses. Name the host.

4. Mark the difference between the actions even when no dialog fires. The "Allow host"
   tooltip already says it writes a wildcard rule; extend the two narrow actions' tooltips
   to say they need request inspection for that host. This is what stops the user reading
   the two buttons as equivalent.

5. Apply the same treatment to
   [`egress-approval-toast.tsx`](../../../packages/ui/src/modules/approvals/components/egress-approval-toast.tsx),
   whose "Always allow this request" / "Always allow this host" are the same two mutations.
   If the shared derivation is worth extracting, put it beside the components rather than
   duplicating it in both.

6. `approvePermanent` can also take ownership of an existing connection-derived rule, which
   promotes the host. The shared function already reports this correctly, because the
   pending rule carries `source: "inbox"` — no special case is needed. Do not add one.

## Acceptance criteria

- [ ] "Allow permanently" confirms when the host is not already promoted, and does not when
      it is.
- [ ] "Deny forever" confirms on the same condition.
- [ ] "Allow host" never confirms, and its wording makes clear it does not interrupt.
- [ ] "Allow once" and "Dismiss" never confirm — they write no rule.
- [ ] The inbox list and the toast behave identically for the same approval.
- [ ] Non-`ext_authz` approvals show no restart wording anywhere.
- [ ] `mise run check`, `mise run test` and `mise run common:check:comment-types` pass.

## Smoke test

Create a sandbox on the strict default-deny preset, then make it issue an outbound request
so a held request reaches the inbox. Confirm rows 7 and 8 of the [README](./README.md)
table:

1. "Allow permanently" on a fresh host → dialog appears; after saving, the gateway pod UID
   changes and `spec.l7Hosts` gains the host.
2. On a second held request for a host already promoted → no dialog, and the pod UID does
   not change.
3. "Allow host" on a fresh host → no dialog, `spec.l7Hosts` unchanged, pod UID unchanged.

Repeat step 1 from the toast to confirm the two surfaces match.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
user can confirm it by hand.
