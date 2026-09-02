# 04 — Gate restricted artifacts

**Depends on:** 01-contain-artifact-frame, 02-restricted-visibility-model, 03-share-host-sign-in
**Part of:** Share an artifact with a restricted group — see [README](./README.md)

## Context

The access decision itself. On the **share host**, a restricted slug must render for the owner
and for listed, verified emails, send everyone without a session to sign in, and show the plain
no-access page to everyone else. The **content host** has no cookies by design, so it cannot
make that decision; instead the share host, having authorized the viewer, mints a short-lived
render token and puts it in the iframe `src`. The content host accepts restricted requests only
with a valid token. Raw bytes and downloads on the share host ride the cookie; on the content
host they ride the token.

## Implementation plan

Apply `/typescript-engineering`.

**Resolution (`services/share-viewer-service.ts`)**

1. Extend `SharedResolution` with `{ state: "restricted"; artifact: ArtifactRow }`.
   `resolveArtifact` returns it when `row.visibility === "restricted"` (after the expiry check,
   so a retention-expired restricted artifact still answers "gone" to everyone).
2. Add `canView(artifact, session): Promise<"allow" | "deny">`: allow when
   `session.sub === artifact.owner`, or when `session.emailVerified && session.email` is in
   `repo.listViewers(artifact.id)`. Nothing is cached; every request re-reads the list.
3. Add a render-token pair backed by a `TtlStore<{ artifactId: string; version: number }>`
   (`"share:render"`, TTL 60 s, `createRedisTtlStore` in `bootstrap.ts`):
   `mintRenderToken(artifact, version)` returns a random url-safe token;
   `redeemRenderToken(token, artifact, version)` peeks (does not consume; the frame may load
   the document and then its raw bytes) and checks both fields match.

**Share host (`viewer/viewer-app.ts`)**

4. Factor the prelude of `/a/:slug` and `/a/:slug/raw` into
   `authorize(c, resolution): Promise<{ ok: true; artifact } | { ok: false; response }>`:
   - `not-found` / `expired`: unchanged responses.
   - `ok` (public): allow.
   - `restricted`: `readShareSession(c)` (slice 03). No session → page route 302 to
     `/auth/login?next=<current path+query>`; raw route 401 plain text. Session present →
     `canView`; deny → 403 with `renderNoAccess({ email: session.email, brandName, logoutUrl:
     "/auth/logout?next=…" })`.
5. Page route: for a restricted artifact, after `allow`, mint a render token and build the
   iframe `src` as `<contentBaseUrl>/a/<slug>?v=N&t=<token>`. Public artifacts keep the plain
   URL. The banner's Source link stays on the share host and carries the cookie, so no token.
6. `recordView` only after a successful authorization, where it is called today.
7. Restricted page and raw responses carry `Cache-Control: private, no-store`.

**Content host (`viewer/content-app.ts`)**

8. Both routes: on a `restricted` resolution, require `?t=` and `redeemRenderToken(t, artifact,
   version)`; otherwise 401 plain text. Never redirect to sign-in from here; the content host
   knows nothing about sessions. `ok` (public) stays open as in slice 01.
9. The image inner and the download card reference `/a/<slug>/raw?v=N` relatively; for
   restricted artifacts the content app must append `&t=<token>` to those inner URLs when it
   builds the document, so the frame's follow-up request carries the same token.
10. Restricted content responses carry `Cache-Control: private, no-store`.

**Renderer (`viewer/renderer.ts`)**

11. `renderNoAccess({ email, brandName, logoutUrl })`: the same shell as `renderNotFound`.
    Copy: heading "You don't have access"; body "You are signed in as `<email>`. Ask the
    person who sent you this link to add you, or sign in with another account."; one link
    "Switch account" → `logoutUrl`. No title, no owner, no view count.
12. When `email` is null (IdP returned none): "Your account has no email address on record, so
    it cannot be on a viewer list." with the same switch-account link.

**Folder page**

13. No change. `resolveFolder` already lists public only.

14. `mise run common:check:comment-types`.

## Acceptance criteria

- [ ] Anonymous `GET <share>/a/<restricted>` → 302 to `/auth/login?next=/a/<restricted>`; after
      signing in as a listed user → 200, the iframe `src` carries `t=`, the frame renders, and
      the view count grows by one.
- [ ] Signed in as an unlisted user → 403 no-access page naming that email, no title in the
      HTML, "Switch account" link present.
- [ ] Signed in as the owner (not on the list) → 200.
- [ ] A listed email whose IdP account is not `email_verified` → 403.
- [ ] `GET <content>/a/<restricted>` without `t` → 401; with a valid `t` → inner document; with
      a `t` older than 60 s, or minted for another artifact or version → 401.
- [ ] `GET <share>/a/<restricted>/raw?v=1` without cookie → 401; with a valid session → bytes.
- [ ] A restricted PNG renders inside the frame (the inner `<img>` URL carries `t`).
- [ ] Removing the viewer's email in the Share dialog makes the next reload return 403 with no
      restart or cache flush.
- [ ] Restricted responses on both hosts carry `Cache-Control: private, no-store`; content
      responses still never set a cookie.
- [ ] Public and private artifacts behave exactly as before; the existing "share viewer
      resolution" unit tests pass unchanged.
- [ ] `mise run api-server:check`, `mise run api-server:test` pass.

## Smoke test

```
mise run api-server:check && mise run api-server:test
mise run cluster:build-apiserver
```

Manual on the dev cluster: use slice 02's smoke-test mutation to restrict an HTML artifact to
`alice@example.com` (create that user in Keycloak admin with a verified email if needed). Walk
the README whole-feature steps 3, 4, 5 and confirm each page. Copy the iframe `src` from
DevTools, wait 70 seconds, open it in a new tab: 401. Repeat step 3 with a PNG artifact and
confirm the image shows.
