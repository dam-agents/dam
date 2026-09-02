# 01 — Serve the artifact frame from a content origin

**Part of:** Share an artifact with a restricted group — see [README](./README.md)

## Context

Today the share page and the artifact it frames live on the same origin, the share host, and
the only thing keeping artifact code away from that origin is the iframe `sandbox` attribute,
which currently grants both `allow-scripts` and `allow-same-origin`. Issue #3485 reports this.
Slice 03 puts a viewer session on the share host, so the boundary must be real before that
lands. The fix is the same shape Claude-style artifact hosts use: the outer page stays on the
share host, and the iframe loads from a **second domain that serves only artifact bytes** and
never has a login, a cookie, or an app route. The browser then enforces the boundary by origin.
Popups and fake login forms opened by an artifact show the content domain in the address bar,
which also covers the phishing half of #3485.

Single content domain for now; a wildcard per-artifact subdomain is the later upgrade if
artifacts ever hold browser storage worth isolating from each other.

## Implementation plan

Apply `/typescript-engineering`. Read "The share host — trust boundary" in
`docs/architecture/artifact-library.md`; this slice adds a sibling host with an even smaller
surface.

**Helm and config**

1. `deploy/helm/platform/values.yaml`: add `urls.content: ""` next to `urls.share` with the
   same comment style (default `{scheme}://content.{domain}{:port}`). Follow how `urls.share`
   is resolved in `_helpers.tpl` and the ingress templates; add the content host to the
   ingress and certificate the same way the share host is wired. Grep for `share` under
   `deploy/helm/platform/templates/` to find every place.
2. `templates/apiserver/app.yaml`: add env `CONTENT_BASE_URL`. `packages/api-server/src/config.ts`:
   `contentBaseUrl: z.url(...)`, required like `shareBaseUrl`. Update `packages/dev-config` and
   any local `.env` templates that carry `SHARE_BASE_URL`.

**Host routing (`packages/api-server/src/modules/artifact-library/viewer/`)**

3. Generalise `share-host-gate.ts` into a small host router: share hostname → share app,
   content hostname → content app, anything else → `next()`. Keep the exported name or rename
   to `createByLinkHostGate`; update `bootstrap.ts`.
4. New `content-app.ts` (`createContentApp(deps)`): a Hono app with exactly two routes and no
   others (no `notFound` redirect to the UI; plain 404 text):
   - `GET /a/:slug` — resolve via `viewer.resolveArtifact`; for `ok` (public) build the **inner
     document** for the artifact's kind using the existing `render*Inner` functions (HTML, JSX
     with import map, markdown, code, image, download card) and return it as a full
     `text/html` response. Version via `?v=`. This is the document that used to go into
     `srcdoc`.
   - `GET /a/:slug/raw` — move the raw streaming handler here (the image inner and the download
     card reference it relatively, so they keep working on the content host). Leave a copy on
     the share host too: the banner's Source link stays on the share host so slice 04 can gate
     it with the cookie.
   Response headers on every content response: `X-Content-Type-Options: nosniff`,
   `Referrer-Policy: no-referrer`, `Content-Security-Policy: frame-ancestors <shareBaseUrl
   origin>` so the content pages can only be framed by the share host, and never a
   `Set-Cookie`. Do not add a content CSP for scripts; the JSX import map still pulls from
   `esm.sh`.
5. `viewer-app.ts` (share host): `/a/:slug` keeps the banner, version nav, and Source link, and
   renders the iframe with `src="<contentBaseUrl>/a/<slug>?v=N"` instead of `srcdoc`. Keep
   `sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"`:
   `allow-same-origin` is now the content origin, which is the intended, harmless one, and
   artifacts need it for normal browser storage. Remove the `innerHtml` plumbing from the
   wrapper renderer. Keep `/f/:slug` unchanged.
6. `renderer.ts`: the wrapper takes `contentUrl` instead of `innerHtml`. The `render*Inner`
   functions stay; they are now the content app's responses. Delete `renderImageInner`'s
   relative-URL assumption only if it breaks; it should not.
7. In-app previews (`packages/ui/src/modules/artifacts/components/deferred-frame.tsx`, the
   docked panel, `getPreviewHtml`) are a different surface on the app origin and stay as they
   are. Note in the commit body that they are unchanged and why.
8. `mise run common:check:comment-types`.

## Acceptance criteria

- [ ] `helm template` renders an ingress rule and certificate entry for the content host, and
      the api-server Deployment carries `CONTENT_BASE_URL`.
- [ ] `GET https://<share>/a/<public slug>` returns the banner page whose iframe `src` points at
      `https://<content>/a/<slug>?v=N`; the response contains no `srcdoc`.
- [ ] `GET https://<content>/a/<public slug>` returns the inner document with
      `Content-Security-Policy: frame-ancestors https://<share>` and no `Set-Cookie`.
- [ ] `GET https://<content>/f/anything` and `GET https://<content>/auth/login` return 404 text.
- [ ] From inside a shared HTML artifact, `document.location.origin` is the content origin and
      `window.parent.document` throws a `SecurityError`.
- [ ] Public HTML, JSX (with `recharts`), markdown, code, and image artifacts render on the
      share host; the Source link downloads.
- [ ] `mise run api-server:check`, `mise run api-server:test`, `mise run helm:check` pass.

## Smoke test

```
mise run api-server:check && mise run api-server:test && mise run helm:check
mise run cluster:build-apiserver && mise run cluster:install
```

Publish four public artifacts: an HTML page whose script writes `location.origin` and the
caught result of `window.parent.document` into the body, a JSX component using `recharts`, a
markdown file, and a PNG. Open each share link. The HTML page shows the content origin and a
`SecurityError`; the other three render as before. Open the content URL directly in a tab: the
artifact renders bare, with the content domain in the address bar.
