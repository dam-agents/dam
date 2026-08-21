# 02 — Public agent page HTTP surface

**Depends on:** 01-public-agent-projection
**Part of:** Public Agent Page — see [README](./README.md)

## Context

With the projection and read service in place, this slice puts the page on the wire: a server-rendered
HTML page at `/a/<agentId>` that anyone can open with no login. It mirrors the existing share viewer,
which is the only other public surface the api-server serves.

Apply the **`/typescript-engineering`** skill.

## Implementation plan

### 1. Ingress — the page is unreachable without this

On the app host, [`_helpers.tpl:128`](../../../deploy/helm/platform/templates/_helpers.tpl) routes
`/api` to the api-server and `/` to the UI nginx. A request for `/a/<agentId>` currently reaches the
**UI**, not the api-server.

Add `/a` as a third prefix in `platform.ingress.appPaths`, before the `/` catch-all:

```yaml
- path: /a
  pathType: Prefix
  backend:
    service:
      name: {{ .apiSvc }}
      port:
        name: http
```

The helper is used by the uiHost rule, the catch-all app rule, and the convention-domain rules in
[`ingress.yaml`](../../../deploy/helm/platform/templates/ingress.yaml), so one edit covers all three.

`pathType: Prefix` matches on path **elements**, so `/a` matches `/a` and `/a/...` but not `/artifacts`
or `/agents`. Verify this on the dev cluster's ingress controller rather than trusting the spec, since a
mismatch here would silently swallow two existing SPA routes.

### 2. Renderer

New file `packages/api-server/src/modules/agents/viewer/renderer.ts`, modelled on
[`artifact-library/viewer/renderer.ts`](../../../packages/api-server/src/modules/artifact-library/viewer/renderer.ts)
(plain template functions returning HTML strings, no template engine).

Two exported renderers, matching the page's two states:

- `renderNamedAgentPage({ agent, brand })` — the agent's name, the owner's email (omitted when
  `ownerEmail` is `null`), the pitch, both CTAs.
- `renderGenericPage({ brand })` — the pitch and both CTAs, no agent-specific content.

Copy rules:

- Say **agent**, never **sandbox** (#3216, applied across the GUI in #3397). The copy agreed in the
  issue thread predates that decision and still says "sandbox"; use "agent" and flag it in the PR so
  product re-approves the wording.
- The pitch is fixed copy, but it must interpolate `brand.name` so no literal brand string appears in
  source. CLAUDE.md forbids hardcoding the brand.
- CTAs are exactly two. **Create your own agent** → `/` (the list view, where creation actually starts;
  `/sandboxes/new` is in `RETIRED_PATHS` and the three concrete create flows would each be a guess at
  a stranger's intent). **Open in DAM** → `/chat/<agentId>/<sessionId>` when `s` is present, else
  `/chat/<agentId>`. That second button serves both the owner returning to their session and an existing
  user logging in.

Use `brand.theme` accent colours and `/api/brand/icon.svg` so the page looks like the product. Emit OG
tags (`og:title`, `og:description`, `og:url`) so the Slack unfurl shows an agent card. Escape every
interpolated value; the agent name is user-controlled.

### 3. Hono app

New file `packages/api-server/src/modules/agents/viewer/public-agent-page-app.ts`, modelled on
[`viewer-app.ts`](../../../packages/api-server/src/modules/artifact-library/viewer/viewer-app.ts):

```ts
export interface PublicAgentPageAppDeps {
  service: PublicAgentPageService;
  brand: Brand;
}
export function createPublicAgentPageApp(deps: PublicAgentPageAppDeps): Hono;
```

- `GET /a/:agentId` — call `service.get`, render named or generic. Always **HTTP 200**, including the
  generic page. A 404 would be an oracle for which agent ids exist and would also make the Slack unfurl
  give up on a stale link.
- Set the same conservative headers the share viewer sets: `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, and a CSP with `frame-ancestors 'self'; form-action 'self'`.
- Pass `config.brand` whole, not just the name, so the renderer can use the theme and icon. Note the
  share viewer takes only `brandName`; do not copy that narrowing.

### 4. Mounting

The api-server does not serve the SPA, and the auth middleware in
[`app.ts`](../../../packages/api-server/src/apps/api-server/app.ts) is scoped to `/api/*`. So this route
is unauthenticated by construction: mount it in `mountRoutes`
([`routes/index.ts`](../../../packages/api-server/src/apps/api-server/routes/index.ts)) and nothing gates
it. Do **not** add a bespoke path gate; there is nothing to bypass. Construct the app in
[`bootstrap.ts`](../../../packages/api-server/src/bootstrap.ts) next to `createShareViewerApp` and thread
it through `ApiServerDeps`.

Confirm the route lands **before** any fallthrough that would claim it, and confirm the terms gate does
not apply (it is `/api/*`-scoped too, but check, because a terms redirect on a public page would be a
silent regression).

## Acceptance criteria

- [ ] `/a/<agentId>` is served by the api-server on the app host, in a browser with no session and no login prompt
- [ ] A bound agent renders its name, its owner's email, the pitch, and exactly two CTAs
- [ ] An unknown id, an unbound agent, and a deleted agent render the **identical** generic page, all HTTP 200
- [ ] No literal brand string appears in the new source; the pitch interpolates `brand.name`
- [ ] The page says "agent" and never "sandbox"
- [ ] The agent name is HTML-escaped
- [ ] OG tags are present and carry the agent name for a named page
- [ ] `pathType: Prefix` on `/a` does not capture `/artifacts` or `/agents`, verified on the cluster
- [ ] Page views perform no K8s read once the projection row exists
- [ ] `mise run check` and `mise run test` pass

## Smoke test

```sh
mise run api-server:check
mise run api-server:test
mise run cluster:build-apiserver
mise run cluster:helm
```

Then, with a Slack-bound agent from slice 01:

```sh
curl -sI  https://<app-host>/a/<agentId>            # 200, no redirect to Keycloak
curl -s   https://<app-host>/a/<agentId> | grep -i "og:title\|<h1"
curl -s   https://<app-host>/a/agent-0000000000000000 | grep -ci "<agent name>"   # 0
curl -sI  https://<app-host>/artifacts               # still reaches the UI, not the api-server
```

Open `/a/<agentId>` in a private browser window and confirm no login prompt, correct branding, and two
working CTAs.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can
confirm it by hand.
