# Technology Stack

The opinionated stack for TypeScript client-server projects.

## Core Technologies

| Layer | Technology | Purpose |
|-------|-----------|---------|
| API | [tRPC](https://trpc.io/) | End-to-end typesafe APIs without code generation |
| Validation | [Zod](https://zod.dev/) | Schema declaration and input validation |
| Language | TypeScript (strict mode) | Type safety across the entire stack |
| Package management | pnpm (default) | Fast, disk-efficient package manager with native workspace support |
| Events | [RxJS](https://rxjs.dev/) (recommended) | Reactive event bus for domain events and sagas |

## Why These Choices

### tRPC over REST/GraphQL

- Full type inference from server to client — no codegen step.
- Router definitions double as API documentation.
- Pairs naturally with Zod for input validation.

### Zod for Validation

- Runtime validation that produces TypeScript types via `z.infer`.
- Composable schemas — build complex validations from simple pieces.
- First-class tRPC integration as input validators.

### Strict TypeScript

The base `tsconfig.json` enables strict mode and additional checks:

- `strict: true` (enables `strictNullChecks`, `noImplicitAny`, etc.)
- `noEmit: true` (type-checking only; bundler handles emit)
- Path aliases via `paths` for clean imports between layers

### RxJS for Domain Events

- Subject-based event bus with typed `emit()` and `events$()` streams.
- `ofType<T>()` operator for type-safe event filtering in subscribers and sagas.
- `mergeMap` / `switchMap` for async side effects in sagas.
- Subscriptions provide clean teardown on shutdown.
- Any reactive or EventEmitter-based approach works — RxJS is the recommended default.

## Server Runtime

The server runtime is pluggable. Supported options:

| Runtime | Adapter | Default |
|---------|---------|---------|
| [Hono](https://hono.dev/) | `@hono/trpc-server` | Yes |
| [Express](https://expressjs.com/) | `@trpc/server/adapters/express` | No |

The tRPC router is mounted at `/trpc` by default. Projects may use a different mount path or multiple root routers as long as the modularization approach described later is followed.

### Hono (default)

```ts
import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "./routers/index.js";

const app = new Hono();

app.use("/trpc/*", trpcServer({ router: appRouter }));

export default {
  port: 3000,
  fetch: app.fetch,
};
```

**Required dependencies:** `hono`, `@hono/trpc-server`, `@trpc/server`
**Required dev dependencies:** `@types/node`

### Express

```ts
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers/index.js";

const app = express();

app.use("/trpc", createExpressMiddleware({ router: appRouter }));

app.listen(3000, () => {
  console.log("Server listening on http://localhost:3000");
});
```

**Required dependencies:** `express`, `@trpc/server`
**Required dev dependencies:** `@types/express`, `@types/node`

## Client

The client connects to the server via a tRPC client. The specific UI framework is flexible (React, Vue, Solid, etc.), but the tRPC client setup is always present to guarantee end-to-end type safety.

When React is used, prefer `@trpc/react-query` for data fetching.

## CORS / Dev Proxy

By default in development, the client dev server (e.g., Vite) proxies tRPC requests to the backend. This avoids CORS entirely — no CORS headers on the server. The proxy path should match the mount path.

```ts
// vite.config.ts
server: {
  proxy: {
    "/trpc": {
      target: "http://localhost:3000",
      changeOrigin: true,
    },
  },
}
```

When using a dev proxy, the tRPC client URL should be relative (e.g., `/trpc`), not an absolute URL.

Alternatively, projects may handle CORS directly on the server (e.g., via middleware). This works for both development and production and removes the need for a dev proxy. In that case the tRPC client URL will be absolute.

## Shared Types

The `AppRouter` type is consumed by the client through an API contract package — a workspace package that exports API type definitions. This is the single source of truth for the API contract — no manual type duplication. The naming and scope of this package is flexible.
