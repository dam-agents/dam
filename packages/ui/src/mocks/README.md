# UI design-preview mock layer

**This folder is a local-only dev aid for UX/UI design previews.** It lets the UI boot and render without a running api-server, Keycloak, or Postgres — useful for iterating on visuals offline.

## How to turn it on

Create `packages/ui/.env.local` (gitignored by this repo) with:

```
VITE_USE_MOCKS=true
```

Then `mise run ui:run`. When the flag is unset (the default for every other dev and for CI/prod builds), nothing in this folder runs.

## How it works

`setup.ts` is dynamically imported from [`main.tsx`](../main.tsx) **only** when `VITE_USE_MOCKS` is `true`. It:

1. Seeds `sessionStorage` with a fake OIDC user so `initAuth()` skips the Keycloak redirect.
2. Monkey-patches `window.fetch` to intercept `/api/*` calls and return canned JSON for the unauthenticated bootstrap endpoints (`/api/auth/config`, `/api/brand`). tRPC calls return an error, which the UI already handles gracefully via react-query empty-state fallbacks.

No production code path references anything in this folder when the flag is off.

## How to remove

Delete this entire folder **and** remove the `VITE_USE_MOCKS` block at the top of [`main.tsx`](../main.tsx) (it's clearly fenced with a comment). Thirty-second cleanup; nothing else depends on it.
