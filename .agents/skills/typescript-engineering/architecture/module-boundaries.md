# Module Boundaries

Bounded contexts must stay loosely coupled. No module may import another module's internals (services, entities, infrastructure). The only cross-module imports allowed are event types and type guards from a module's `index.ts`.

Modules communicate exclusively through **domain events** — records of something meaningful that happened in the domain, named in past tense using business language: `OrderPlaced`, `UserRegistered`, `PaymentCompleted`.

## Event Ownership

Events are defined in the **publishing module's** domain layer:

```
modules/orders/domain/events/OrderPlaced.ts
```

The publishing module is the single source of truth for the event's shape.

## Event Structure

```typescript
// modules/orders/domain/events/OrderPlaced.ts
type OrderPlaced = {
  type: 'OrderPlaced';
  orderId: string;
  items: ReadonlyArray<OrderItem>;
};

const isOrderPlaced = (event: DomainEvent): event is OrderPlaced =>
  event.type === 'OrderPlaced';
```

Every event has a `type` discriminant and a corresponding type guard.

## Event Bus

The event bus is the runtime mechanism for publishing and subscribing to domain events. It lives outside any specific module — typically in a shared `events.ts` at the server package root.

### Event Registry

All event types are registered in a central enum and union type:

```typescript
// events.ts
export enum EventType {
  OrderPlaced = "OrderPlaced",
  OrderCancelled = "OrderCancelled",
  PaymentCompleted = "PaymentCompleted",
}

export type DomainEvent = OrderPlaced | OrderCancelled | PaymentCompleted;
```

### Publishing

Services emit events after successful state changes:

```typescript
import { emit } from '../../events.js';

async create(input) {
  const order = await deps.repo.create(input, deps.owner);
  emit({ type: EventType.OrderPlaced, orderId: order.id, items: input.items });
  return order;
}
```

### Subscribing

Subscribers filter the event stream by type. Use a reactive library (e.g., RxJS) or a simple EventEmitter — the mechanism is flexible, the pattern is fixed:

```typescript
import { events$, ofType } from '../../events.js';
import { type OrderPlaced } from '../orders/index.js';

events$().pipe(
  ofType<OrderPlaced>(EventType.OrderPlaced),
).subscribe((event) => {
  // React to the event
});
```

The `ofType` operator narrows the event type, giving subscribers full type safety.

## Sagas (Process Managers)

Sagas are long-running event handlers that react to domain events and perform side effects — typically cross-module cleanup, coordination, or integration with external systems. They bridge the event stream to infrastructure actions.

### Structure

Sagas live in a `sagas/` directory within the module that owns the reaction:

```
modules/orders/
  sagas/
    inventory-reservation.ts
    notification.ts
```

Sagas that coordinate across multiple modules or don't belong to a single bounded context may live outside modules — for example in a dedicated `workers` package or a top-level `sagas/` directory:

```
packages/workers/src/
  saga.ts
  order-lifecycle.ts
```

### Pattern

A saga subscribes to one or more event types and performs side effects:

```typescript
// modules/shipping/sagas/order-fulfillment.ts
export function startOrderFulfillmentSaga(deps: {
  shippingService: ShippingService;
}): Subscription {
  return events$().pipe(
    ofType<OrderPlaced>(EventType.OrderPlaced),
    mergeMap(async (event) => {
      await deps.shippingService.createShipment(event.orderId, event.items);
    }),
  ).subscribe();
}
```

### Saga Rules

- Sagas handle **side effects** — I/O, infrastructure cleanup, external system calls.
- A saga returns a subscription handle so it can be torn down on shutdown.
- Sagas receive dependencies via injection (same factory pattern as services).
- Error handling within sagas should be resilient — log and continue, don't crash the process.
- Sagas are started at application boot, typically from the composition root or server setup.

### When to Use Sagas vs. Services

| Use a **service** when... | Use a **saga** when... |
|---|---|
| The operation is part of the primary request/response flow | The operation is a reaction to something that already happened |
| The caller needs the result | The result is fire-and-forget |
| The logic belongs to one bounded context | The reaction crosses bounded contexts |

## Subscribing

A subscribing module imports only the event type and type guard from the publisher's `index.ts`:

```typescript
// modules/shipping/services/onOrderPlaced.ts
import { type OrderPlaced, isOrderPlaced } from '../../orders/index.js';
```

The subscriber knows about the event shape but nothing else about the publishing module's internals.

## Dependency Direction

```
orders  ──emits──▶  OrderPlaced
                         ▲
shipping ──subscribes────┘
```

- The publishing module (`orders`) knows nothing about its subscribers.
- The subscribing module (`shipping`) depends on the event type from `orders/index.ts`.
- This is a one-way dependency on a stable contract (the event shape), not on implementation details.

## What Is Not Allowed

- Importing a service from another module (`import { createUser } from '../identity/services/...'`)
- Importing a domain entity from another module (`import { User } from '../identity/domain/...'`)
- Importing a repository from another module (`import { UsersRepository } from '../identity/infrastructure/...'`)
- Any import that bypasses `index.ts`
