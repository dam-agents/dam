# 03 — Sign-in on the share host

**Part of:** Share an artifact with a restricted group — see [README](./README.md)

## Context

The share host has never had an identity. This slice gives it one, without yet using it for
anything: a Keycloak public client for the share origin, an authorization-code + PKCE flow
served by the share host app, and a Redis-backed share session behind an `HttpOnly` cookie.
Slice 04 reads that session. Keeping the plumbing separate keeps 04 about access decisions.

The app origin and the share origin must keep sharing nothing. That is why this is a second
Keycloak client, a second cookie, and a server-side session rather than the SPA's token flow.

## Implementation plan

Apply `/typescript-engineering`. Read `docs/architecture/security-and-credentials.md`
("Identity") and the "share host" section of `docs/architecture/artifact-library.md`.

**Helm and config**

1. `deploy/helm/platform/values.yaml`: add `keycloak.shareClientId: platform-share` next to
   `cliClientId`, with a comment: public client for the artifact share host's viewer sign-in;
   redirect is `{urls.share}/auth/callback`.
2. `deploy/helm/platform/templates/keycloak/realm-configmap.yaml`: add a client entry modelled
   on the UI client: `publicClient: true`, `standardFlowEnabled: true`,
   `directAccessGrantsEnabled: false`, `redirectUris: ["<share url>/auth/callback"]`,
   `webOrigins: ["<share url>"]`, `attributes.pkce.code.challenge.method: S256`. No audience
   mapper: slice 04 uses the ID token, whose `aud` is the client id. Resolve the share URL the
   same way `SHARE_BASE_URL` is resolved in `templates/apiserver/app.yaml` (default
   `share.{domain}`); factor a helper in `_helpers.tpl` if one does not exist.
   keycloak-config-cli applies the change on upgrade, so existing installs get the client.
3. `templates/apiserver/app.yaml`: add env `KEYCLOAK_SHARE_CLIENT_ID` from the value.
   `packages/api-server/src/config.ts`: `keycloakShareClientId: z.string().default("platform-share")`
   read from that env.
4. Dev config: check `packages/dev-config` and any `.env` templates that enumerate
   `KEYCLOAK_*` and add the new one so local runs are explicit.

**Share session module (`packages/api-server/src/modules/artifact-library/`)**

5. `domain/share-session.ts`: types `ShareSession = { sub: string; email: string | null;
   emailVerified: boolean; createdAt: number }` and `PendingLogin = { codeVerifier: string;
   nonce: string; next: string; createdAt: number }`. Pure helpers: `isSafeNext(path)`
   (accepts only `/a/<slug>` and `/a/<slug>/raw…` relative paths on this host; rejects
   protocol-relative and absolute URLs) and cookie name constant `share_session`.
6. `services/share-auth-service.ts`: a service built from
   `{ issuerUrl, jwksUrl, tokenUrl, authUrl, clientId, shareBaseUrl, pending: TtlStore<PendingLogin>,
   sessions: TtlStore<ShareSession>, now }`:
   - `beginLogin(next)`: mint `state`, PKCE verifier/challenge (S256, `node:crypto`), `nonce`;
     store `PendingLogin` under `state` (TTL 5 min); return the Keycloak authorize URL built on
     the **external** Keycloak URL (browser-facing).
   - `completeLogin(state, code)`: consume the pending entry; POST the token request to the
     **internal** token URL (`config.keycloakUrl`, same split `bootstrap.ts` already does for
     `issuerUrl` vs `jwksUrl`); verify the ID token with `jose` `jwtVerify` against the JWKS
     (`issuer = issuerUrl`, `audience = clientId`), check `nonce`; read `sub`, `email`,
     `email_verified`; store `ShareSession` under a fresh random id (TTL 12 h); return
     `{ sessionId, next }`.
   - `getSession(sessionId)`, `endSession(sessionId)`.
   Use `createRedisTtlStore(sharedRedis, "share:login", …)` and `("share:session", …)` in
   `bootstrap.ts`, next to the other `oauth:*` stores. Redis is already mandatory there.
7. `viewer/share-auth-routes.ts`: a Hono sub-app mounted at `/auth` in the share host app:
   - `GET /auth/login?next=…`: validate `next` with `isSafeNext` (fallback `/`), call
     `beginLogin`, 302 to Keycloak.
   - `GET /auth/callback?state=&code=`: `completeLogin`, set cookie
     `share_session=<id>; HttpOnly; Secure (when shareBaseUrl is https); SameSite=Lax; Path=/;
     Max-Age=43200`, 302 to `next`. On any failure render a small "Sign-in didn't work, try
     again" page (platform chrome, `brandName`) with a link back to `/auth/login?next=…`.
   - `GET /auth/logout`: end the session, clear the cookie, 302 to `/auth/login?next=<next>`.
     This is the "switch account" action slice 04 links to. Also redirect to Keycloak's
     end-session endpoint with `post_logout_redirect_uri` back to the login URL so the
     Keycloak SSO cookie is dropped too; otherwise "switch account" silently signs the same
     person back in.
   - A helper `readShareSession(c)` that other routes call: reads the cookie, looks up the
     store, returns `ShareSession | null`. Export it for slice 04.
8. Mount in `packages/api-server/src/modules/kb-shares/serving/compose.ts`
   `createShareHostApp` (or move share-host composition into the artifact-library module if
   that reads cleaner; keep the KB MCP route first, then `/auth`, then the viewer fallback).
   Thread the new deps from `bootstrap.ts`.
9. Headers: keep the viewer's existing conservative headers on the auth pages
   (`Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, framing to self).
10. `mise run common:check:comment-types`.

## Acceptance criteria

- [ ] `helm template` of the chart shows a `platform-share` client with the share-host
      callback as its only redirect URI and PKCE S256.
- [ ] `GET https://<share>/auth/login?next=/a/xyz` 302s to Keycloak with
      `client_id=platform-share`, `code_challenge_method=S256`, `state`, `nonce`.
- [ ] After signing in, the browser lands on `/a/xyz` with a `share_session` cookie flagged
      `HttpOnly`, `SameSite=Lax`, and `Secure` on https installs.
- [ ] `GET /auth/login?next=https://evil.example` redirects, after sign-in, to `/`, not to the
      external URL.
- [ ] `GET /auth/logout` clears the cookie and a subsequent `/auth/login` shows the Keycloak
      login form again (SSO cookie dropped).
- [ ] No cookie is ever set on the app origin, and the ID token is never written to the
      browser.
- [ ] `mise run api-server:check`, `mise run api-server:test`, `mise run helm:check` pass.

## Smoke test

```
mise run api-server:check && mise run api-server:test
mise run cluster:build-apiserver && mise run cluster:install
```

Then in a private window open `https://share.<dev domain>/auth/login?next=/a/anything`. Sign in
as a realm user. You land on `/a/anything` (a 404 page is fine at this slice) and DevTools
shows the `share_session` cookie on the share host only. Open `/auth/logout`, then
`/auth/login` again: the Keycloak form asks for credentials.
