# Modules and Bounded Contexts

The server is organized into **modules**, each a vertical slice for one bounded context.

## Bounded contexts

A bounded context is a boundary within which one domain model and language apply. The same real-world concept is modeled differently per context: in **Identity** a User has credentials, sessions and login history; in **Billing** a Customer has a payment method, invoices and a plan; in **Shipping** a Recipient has an address and delivery preferences. Each context owns its model and models only what it needs; there is no unified model.

Bounded context (strategic DDD: where is the model's boundary?), vertical slice (architecture: how does code reflect it?) and module (codebase: what's the folder called?) are three views of one thing; module ↔ bounded context is 1:1. **Modules follow business boundaries, not technical concerns**: `identity/`, `billing/`, `orders/`, never `database/`, `middleware/`, `utils/`.

## Definition vs implementation

- **Definition** (contract package): *what* the module exposes. Flat, no layers.
  ```
  packages/api-contract/src/modules/
    identity/
      types.ts    Zod schemas, input/output types, service interface
      router.ts   tRPC router accepting a service implementation
    billing/ ...
  ```
  The router delegates every call to the service implementation (no business logic); the service interface is the method contract the server implements. Interface naming (`*Service`, `*Context`, …) is free, but file, interface and variable names agree within a project.

- **Implementation** (server package): *how* it works, in the three layers ([slice-composition.md](slice-composition.md)). Validation stays in the contract package.
  ```
  packages/server/src/modules/
    identity/
      services/         application layer
      domain/           pure TypeScript
        events/         domain events owned by this module
      infrastructure/   repositories, mappers, adapters
      sagas/            event-driven side effects (optional)
      compose.ts        composition root
      index.ts          public API, the module boundary
    billing/ ...
  ```

Within a module the layer rule holds, `services → domain ← infrastructure`: contract routers delegate to the service interface; services coordinate domain objects and receive repositories/adapters by injection; domain has zero external deps; infrastructure implements inner-layer ports.

## Composition root (`compose.ts`)

The **only place** concrete infrastructure is referenced: takes raw dependencies (DB connections, API clients), returns wired services. Factory pattern: [infrastructure.md](infrastructure.md).

```typescript
// modules/orders/compose.ts
export function composeOrdersModule(db: Database, owner: string) {
  const repo = createOrdersRepository(db);
  return {
    orders: createOrdersService({ repo, owner }),
    tracking: createTrackingService({ repo, owner }),
  };
}
```

## Public API (`index.ts`)

The **only** entry point other modules may import. It exports domain event types and their type guards; nothing else. Services, entities, value objects, aggregates and infrastructure stay private.

```typescript
// modules/orders/index.ts
export { type OrderPlaced, isOrderPlaced } from './domain/events/OrderPlaced.js';
export { type OrderCancelled, isOrderCancelled } from './domain/events/OrderCancelled.js';
```

Inter-module communication (domain events, event bus, sagas, dependency direction, forbidden imports): [module-boundaries.md](module-boundaries.md).

## Identifying bounded contexts

1. **Own language?** Different words, or the same words meaning different things, suggest a separate context.
2. **Changes independently?** If billing changes shouldn't require shipping changes, separate modules.
3. **Own invariants?** A cohesive, self-contained set of business rules likely forms a context.

Start with fewer, larger modules and split when language or invariants diverge; premature splitting adds needless event plumbing.
