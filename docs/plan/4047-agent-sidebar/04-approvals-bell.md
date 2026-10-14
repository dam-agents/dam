# 04 — Approvals bell

**Depends on:** 03-activity
**Part of:** Global sidebar with agents and activity — see [README](./README.md)

## Context

With session activity in the sidebar, the top-right panel keeps one job: what waits on the user's decision.
It becomes a bell that lists approvals only (the issue's proposed solution).

## Implementation plan

Apply `/react-ui-engineering`.

1. `ActivityButton` (`modules/home/components/notifications-panel.tsx`, mounted twice in `app.tsx`): Carbon `Notification` bell icon; the badge keeps counting waiting approvals (`useWaitingApprovals`). Rename the component and the `activityView` value to match ("approvals").
2. `NotificationsPanel`: list approval items only; drop session rows, the session filter bar and their empty states; an empty state says no approvals wait.
3. Delete code only the panel's session list used; keep what the sidebar Activity (03) uses.

## Acceptance criteria

- [ ] The top-right control is a bell; its badge counts waiting approvals.
- [ ] The panel lists approvals only, and approving or denying works as before.
- [ ] `mise run //packages/ui:check` and `mise run //packages/ui:test` pass.

## Smoke test

Trigger an approval (for example a blocked egress request on an agent): the bell badge shows 1, the panel lists it, approving clears it; session updates never appear in the panel.
