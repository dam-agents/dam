# 02 — Public agent page

**Depends on:** 01-public-agent-projection
**Part of:** Public Agent Page — see [README](./README.md)

> **This slice was re-planned during implementation.** It originally specified a server-rendered page
> built from HTML template strings in the api-server, modelled on the share viewer. Both arguments for
> that shape turned out to be false (see *Why a route in the SPA* in the [README](./README.md)), and it
> cost a third copy of the app's design tokens. The slice now puts the page in the SPA.

## Context

Slice 01 built the projection and the read service. This slice puts the page in front of a stranger:
a route at `/a/<agentId>` that renders with no login, reading one unauthenticated endpoint.

Apply **`/typescript-engineering`** to the api-server work and **`/react-ui-engineering`** to the UI work.

## Implementation plan

### 1. The shared response contract

`publicAgentViewSchema` and `publicAgentResponseSchema` in
[api-server-api](../../../packages/api-server-api/src/modules/agents/public-agent.ts), following
`brandSchema`: one definition, validated on the server as a `satisfies` type and on the client with
`safeParse`. The api-server service drops its local `PublicAgentView` and imports this one.

### 2. Public read endpoint

`createPublicAgentRoutes` in
[public-agent-routes.ts](../../../packages/api-server/src/modules/agents/infrastructure/public-agent-routes.ts),
mounted at `/api/public` in [routes/index.ts](../../../packages/api-server/src/apps/api-server/routes/index.ts).

- `GET /api/public/agents/:agentId` always answers **200**. An unknown id, an unbound agent and a
  deleted agent all return `{ agent: null }`. A 404 would be an oracle for which agent ids exist.
- `Cache-Control: no-store`. The answer names a person and an agent can be renamed or deleted at any
  moment.
- Add `/api/public/*` to `PUBLIC_PATHS` in [app.ts](../../../packages/api-server/src/apps/api-server/app.ts).
  A dedicated public namespace keeps the auth carve-out to one prefix, rather than a hole inside
  `/api/agents/*` where every neighbouring route is owner-gated.
- The terms gate needs no change. It is `/api/*`-scoped, but it short-circuits on `if (!user)`, and
  the auth middleware never sets a user on a public path. Verified, not assumed.

### 3. SPA route and the bootstrap carve-out

`parsePublicAgentPath` in [routes.ts](../../../packages/ui/src/modules/platform/lib/routes.ts) returns
the agent id for `/a/<agentId>` and `null` for everything else.

The page deliberately does **not** join the `Route` union or the route store.
[main.tsx](../../../packages/ui/src/main.tsx) checks the pathname first and returns before `initAuth`:

```ts
const publicAgentId = parsePublicAgentPath(window.location.pathname);
if (publicAgentId !== null) {
  await loadBrand().then(applyBrand);
  const { renderPublicAgentPage } = await import("./public-agent-page.js");
  await renderPublicAgentPage(publicAgentId);
  return;
}
```

Two reasons for the early return rather than a view inside `App`:

- `initAuth` ends in an unconditional `signinRedirect()` when there is no valid session. Anything that
  reaches it bounces to Keycloak.
- Returning before auth means no code path exists from this page into an authenticated tree. The
  alternative, a public view inside `App`, would rely on every future view and query respecting a flag.

The page is therefore the same for everyone, owner or stranger, which is what the README's *nobody is
identified* rule already required.

The dynamic import also keeps the page in its own chunk, so a visitor never pulls the 1.9MB app chunk.

### 4. The page

[public-agent-view.tsx](../../../packages/ui/src/modules/agents/views/public-agent-view.tsx), built
from the real `Button` and the app's Tailwind tokens. Two states, matching the read service:

- **named** — agent name, owner byline (omitted when `ownerEmail` is `null`), the Slack hint, the pitch, both CTAs
- **generic** — the pitch and both CTAs, no agent-specific content

Layout follows the design prototype attached to the issue thread. Copy rules:

- Say **agent**, never **sandbox** (#3216, applied across the GUI in #3397). The copy agreed in the
  issue thread predates that decision and still says "sandbox".
- Interpolate `brand.name`; CLAUDE.md forbids hardcoding the brand. The agreed pitch called the product
  "an IBM Research platform", which would hardcode an organisation in a white-labelled product, so that
  clause is dropped. **Flag for product re-approval.**
- CTAs are exactly two. **Create your own agent** → `/`. **Open in \<brand\>** → `/chat/<agentId>/<sessionId>`
  when `?s=` is present, else `/chat/<agentId>`. The prototype's primary CTA reads "Join the waitlist";
  **flag for product** whether that waitlist is real.

Data arrives as a prop, fetched once in the entry before first paint. This deviates from the
"server state lives in TanStack Query" default on purpose: it is one-shot bootstrap data with no
refetch, no mutation and no second reader, fetched exactly the way `loadBrand()` already is, and the
query client is wired to the authenticated tRPC client this page must not touch.

### 5. gzip

nginx was serving the bundle uncompressed. [default.conf](../../../packages/ui/default.conf) enables
gzip. This is not strictly part of the feature, but the page is the one surface where a stranger on a
phone pays the bundle cost, and it takes the entry chunk from 654KB to 194KB.

## Acceptance criteria

- [ ] `/a/<agentId>` renders in a browser with no session and no login prompt
- [ ] A bound agent renders its name, its owner's email, the Slack hint and exactly two CTAs
- [ ] An unknown id, an unbound agent and a deleted agent render the **identical** generic page
- [ ] `GET /api/public/agents/<id>` answers 200 for every id, `no-store`, and needs no token
- [ ] The matcher refuses every authenticated path (`/`, `/chat/...`, `/artifacts`, `/agents`, `/auth/callback`)
- [ ] No literal brand string in the new source; copy interpolates `brand.name`
- [ ] The page says "agent" and never "sandbox"
- [ ] The page uses the app's own components and tokens; no new copy of the palette
- [ ] Page views perform no K8s read once the projection row exists
- [ ] `mise run check` and `mise run test` pass

## Smoke test

```sh
mise run api-server:check && mise run api-server:test
mise run ui:check && mise run ui:test
mise run cluster:build-apiserver && mise run cluster:build-ui
```

Then, with a Slack-bound agent from slice 01:

```sh
curl -s   http://<app-host>/api/public/agents/<agentId>            # 200, {"agent":{...}}
curl -s   http://<app-host>/api/public/agents/agent-000000000000   # 200, {"agent":null}
curl -sI  http://<app-host>/artifacts                              # still the UI
```

The endpoint checks are curl-able. **The page is not**: it renders client-side, so `curl` sees only the
SPA shell. It must be checked in a real browser, in a private window, which is also the only way to
confirm there is no login bounce. A previous round of this slice passed every curl check while being
broken in every browser that had loaded the app before.
