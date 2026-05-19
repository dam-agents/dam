# TypeScript Engineering Architecture

Opinionated architecture for TypeScript client-server projects. Read this overview first to understand the full picture, then drill into specific files for details.

## Topics

- **[Stack](stack.md)** — Technology choices: tRPC, Zod, Hono/Express, strict TypeScript, pnpm. Server runtime, client setup, dev proxy, shared types.
- **[Slice Composition](slice-composition.md)** — The three horizontal layers within each server module: application (services) → domain (pure TS) ← infrastructure (adapters). Validation (tRPC routers) lives in the contract package. Dependency rules, error handling.
- **[Infrastructure](infrastructure.md)** — Ports and adapters. Repository pattern, mappers, external system adapters, dependency injection via service factories.
- **[Modules](modules.md)** — Bounded contexts as vertical slices. Module isolation, `index.ts` as public API boundary, composition root, intra-module layer rules. Links to [module boundaries](module-boundaries.md) for loose coupling and inter-module communication via domain events.
- **[Module Boundaries](module-boundaries.md)** — Loose coupling between bounded contexts. Domain events, event bus, sagas (process managers), dependency direction, forbidden imports.
- **[Project Structure](project-structure.md)** — Monorepo layout, package responsibilities, workspace config, TypeScript config, project metadata format.
