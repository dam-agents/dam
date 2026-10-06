# TypeScript Engineering Architecture

Opinionated architecture for TypeScript client-server projects. Read this overview, then only the files the work needs.

- **[Stack](stack.md)**: tRPC, Zod, Hono/Express, strict TypeScript, pnpm; server runtime, client setup, dev proxy, shared types.
- **[Slice Composition](slice-composition.md)**: the three layers in each server module, application (services) → domain (pure TS) ← infrastructure (adapters); validation (tRPC routers) in the contract package; dependency rules, error handling.
- **[Infrastructure](infrastructure.md)**: ports and adapters; repositories, mappers, external adapters, DI via service factories.
- **[Modules](modules.md)**: bounded contexts as vertical slices; module isolation, `index.ts` as the public boundary, composition root, intra-module layer rules.
- **[Module Boundaries](module-boundaries.md)**: loose coupling via domain events; event bus, sagas, dependency direction, forbidden imports.
- **[Project Structure](project-structure.md)**: monorepo layout, package responsibilities, workspace and TypeScript config.
