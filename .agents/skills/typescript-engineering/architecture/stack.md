# Technology Stack

| Layer | Technology |
|-------|-----------|
| API | [tRPC](https://trpc.io/) |
| Validation | [Zod](https://zod.dev/) |
| Language | TypeScript (strict) |
| Packages | pnpm (default) |
| Events | [RxJS](https://rxjs.dev/) (recommended) |

## Why

- **tRPC over REST/GraphQL**: full server-to-client type inference with no codegen; router definitions double as API docs; pairs with Zod.
- **Strict TypeScript**: the base config sets `strict: true` (`strictNullChecks`, `noImplicitAny`, …), `noEmit: true` (type-check only; the bundler emits), and `paths` aliases for clean cross-layer imports.
- **RxJS events**: Subject-based bus with typed `emit()` and `events$()`; `ofType<T>()` for type-safe filtering in subscribers and sagas; `mergeMap`/`switchMap` for async saga effects; subscriptions give clean teardown. Any reactive or EventEmitter approach works; RxJS is the default.

## Server Runtime

Pluggable; the router mounts at `/trpc` by default. Another mount path or several root routers are fine as long as the modularization below holds.

| Runtime | Adapter | Default |
|---------|---------|---------|
| [Hono](https://hono.dev/) | `@hono/trpc-server` | Yes |
| [Express](https://expressjs.com/) | `@trpc/server/adapters/express` | No |

```ts
import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "./routers/index.js";

const app = new Hono();
app.use("/trpc/*", trpcServer({ router: appRouter }));
export default { port: 3000, fetch: app.fetch };
```

Requires `hono`, `@hono/trpc-server`, `@trpc/server`; dev `@types/node`.

```ts
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers/index.js";

const app = express();
app.use("/trpc", createExpressMiddleware({ router: appRouter }));
app.listen(3000, () => console.log("Server listening on http://localhost:3000"));
```

Requires `express`, `@trpc/server`; dev `@types/express`, `@types/node`.

## Client

Any UI framework (React, Vue, Solid…), but always a tRPC client for end-to-end types. With React, use `@trpc/tanstack-react-query` for data fetching.

## CORS / Dev Proxy

By default the client dev server (e.g. Vite) proxies tRPC to the backend, so the server sends no CORS headers; the proxy path matches the mount path and the client URL is relative (`/trpc`).

```ts
// vite.config.ts
server: { proxy: { "/trpc": { target: "http://localhost:3000", changeOrigin: true } } }
```

Alternatively handle CORS on the server (middleware), which works in dev and prod without a proxy; the client URL is then absolute.

## Shared Types

Clients consume `AppRouter` from the API contract package (flexible name and scope), the single source of truth for the contract; no hand-duplicated types.
