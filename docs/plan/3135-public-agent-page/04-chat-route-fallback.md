# 04 — Chat route falls back to the public page

**Depends on:** 02-public-agent-page-surface
**Part of:** Public Agent Page — see [README](./README.md)

## Context

This is the slice that actually closes the state in the issue title. A **logged-in non-owner** who opens
`/chat/<agentId>` still reaches a dead end: [chat-view.tsx](../../../packages/ui/src/modules/sessions/views/chat-view.tsx)
has no not-found branch at all. Without this, the feature ships with its own "Open in DAM" CTA leading
back into the bug being fixed.

Apply the **`/react-ui-engineering`** skill.

## Implementation plan

In `packages/ui`, on the chat route only: when the agent read resolves to forbidden or missing, navigate
to `/a/<agentId>`.

- Find where the chat route resolves its agent. `useResolvedAgentDisplay` and the chat view's own agent
  selection are the starting points; [`use-sandbox-settings-form.ts:178`](../../../packages/ui/src/modules/sandboxes/hooks/use-sandbox-settings-form.ts#L178)
  shows how the sandbox route already models a `not-found` status and is the pattern to follow.
- Distinguish "not yet loaded" from "loaded and denied". Redirecting on a transient undefined during load
  would bounce owners out of their own chat on every cold start, which is a worse bug than the one being
  fixed. Key off the query's settled error state, not off a falsy agent.
- Use a full navigation (`window.location.assign`), not the SPA router. `/a/<agentId>` is served by the
  api-server, not the SPA, so a client-side route change would not reach it.
- Do the same for the agent-home route's existing `not-found` branch if it is cheap. That branch is in
  [sandbox-home-view.tsx](../../../packages/ui/src/modules/sandboxes/views/sandbox-home-view.tsx) and
  now reads "Agent not found." after #3397. It is the string the issue title quotes, though it is not
  the page the Slack footer actually links to.

Do not attempt to distinguish "forbidden" from "deleted" in the UI. The public page renders both
identically by design, so the redirect does not need to know which it hit.

## Acceptance criteria

- [ ] A logged-in non-owner opening `/chat/<agentId>` lands on `/a/<agentId>`
- [ ] The owner opening `/chat/<agentId>` or `/chat/<agentId>/<sessionId>` is unaffected, including on a cold start where the agent read is briefly pending
- [ ] No redirect fires while the agent query is still loading
- [ ] The redirect is a full navigation, so the api-server-served page is actually reached
- [ ] `mise run ui:check` and `mise run check` pass

## Smoke test

```sh
mise run ui:check
mise run cluster:build-ui
```

On the dev cluster, with two user accounts:

1. As the owner, open `/chat/<agentId>`. The session opens. Hard-reload a few times and confirm no
   redirect fires during loading.
2. As a different logged-in user, open the same `/chat/<agentId>`. It redirects to `/a/<agentId>` and the
   public page renders.
3. As that same user, click **Open in DAM** on the public page. It goes to chat and bounces straight back
   to the public page, with no dead end and no error.

Step 3 is the loop this slice closes; run it explicitly.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can
confirm it by hand.
