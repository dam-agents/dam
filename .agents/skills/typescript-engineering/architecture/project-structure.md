# Project Structure

## Monorepo Layout

```
project-root/
├── package.json                  workspace root ("workspaces" field)
├── tsconfig.base.json            shared strict TypeScript config
├── pnpm-workspace.yaml           (with pnpm)
└── packages/
    ├── <server-pkg>/             one or more; name is free
    │   ├── package.json          @trpc/server, zod, rxjs
    │   ├── tsconfig.json         extends ../../tsconfig.base.json
    │   └── src/
    │       ├── events.ts         domain event bus (enum, union type, emit/subscribe)
    │       └── modules/<module>/ see modules.md (e.g. identity/, billing/, orders/)
    │           ├── services/         application layer
    │           ├── domain/           domain layer
    │           │   └── events/       domain events owned by this module
    │           ├── infrastructure/   repos, mappers, adapters
    │           ├── sagas/            process managers (optional)
    │           ├── compose.ts        composition root: wires infra to services
    │           └── index.ts          public API: exports only event types + guards
    ├── <client-pkg>/             one or more; name is free
    │   ├── package.json          @trpc/client (+ framework deps)
    │   ├── tsconfig.json         extends ../../tsconfig.base.json
    │   └── src/                  UI + tRPC client setup
    └── <api-contract-pkg>/
        ├── package.json
        ├── tsconfig.json         extends ../../tsconfig.base.json
        └── src/
            ├── modules/<module>/ flat, no layers
            │   ├── types.ts      types + service interface
            │   └── router.ts     tRPC router delegating to services
            └── index.ts          exports AppRouter type + re-exports
```

Package names are **not enforced** (`api-server`, `backend`, `web`, `ui`, `dashboard`…); the role (server, client, contract) and the internal structure matter. A project may have several server or client packages.

## Package Responsibilities

### Server packages

Backend logic in modules, each a bounded context as a vertical slice with three layers: services, domain, infrastructure ([slice-composition.md](slice-composition.md), [modules.md](modules.md)).

**Required:** `@trpc/server`, `zod`, `rxjs`; dev: `@types/node`.

### Client packages

Consume the API through a typed tRPC client; any UI framework. **Required:** `@trpc/client`.

### API contract package

Defines the contract: router types, router implementations and service interfaces. Clients consume its `AppRouter` type for end-to-end type safety. **Flat modules, no layers**, each with:

- **Types + service interface**: Zod schemas, input/output types, and the interface between router and implementation.
- **Router**: a tRPC router taking a service implementation and delegating every call to it; no business logic.

Service-interface naming (`*Service`, `*Context`, …) is free, but file, interface and variable names agree within a project.

### Other packages

Packages outside this architecture (other languages, shared utilities, infra tooling) may exist; the architecture enforces no rules on them.

## Workspace Configuration

- **pnpm** (default): `pnpm-workspace.yaml` with `packages: ["packages/*"]`.
- **npm / yarn / bun**: `"workspaces": ["packages/*"]` in the root `package.json`.

## TypeScript Configuration

Each package extends the root's strict `tsconfig.base.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "./src", "outDir": "./dist" },
  "include": ["src"]
}
```

Server packages add `"types": ["node"]` to `compilerOptions`.
