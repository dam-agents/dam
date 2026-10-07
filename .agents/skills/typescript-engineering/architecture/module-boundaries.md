# Module Boundaries

Bounded contexts stay loosely coupled: no module imports another's internals (services, entities, infrastructure). The only allowed cross-module imports are event types and type guards from a module's `index.ts`. Modules communicate exclusively through **domain events**: records of something meaningful that happened, named in past tense in business language (`OrderPlaced`, `UserRegistered`, `PaymentCompleted`).

## Events

Defined in the **publishing module's** domain layer (`modules/orders/domain/events/OrderPlaced.ts`), the single source of truth for the shape. Every event has a `type` discriminant and a type guard:

```typescript
type OrderPlaced = {
  type: 'OrderPlaced';
  orderId: string;
  items: ReadonlyArray<OrderItem>;
};

const isOrderPlaced = (event: DomainEvent): event is OrderPlaced => event.type === 'OrderPlaced';
```

## Event bus

Lives outside any module, typically `events.ts` at the server package root, with every event registered in a central enum and union:

```typescript
export enum EventType {
  OrderPlaced = "OrderPlaced",
  OrderCancelled = "OrderCancelled",
  PaymentCompleted = "PaymentCompleted",
}

export type DomainEvent = OrderPlaced | OrderCancelled | PaymentCompleted;
```

Services emit after successful state changes:

```typescript
import { emit } from '../../events.js';

async create(input) {
  const order = await deps.repo.create(input, deps.owner);
  emit({ type: EventType.OrderPlaced, orderId: order.id, items: input.items });
  return order;
}
```

Subscribers filter by type; the mechanism (RxJS, EventEmitter) is flexible, the pattern fixed. `ofType` narrows the event for full type safety. A subscriber imports only the event type and guard from the publisher's `index.ts`, knowing its shape and nothing else.

```typescript
import { events$, ofType } from '../../events.js';
import { type OrderPlaced } from '../orders/index.js';

events$().pipe(ofType<OrderPlaced>(EventType.OrderPlaced)).subscribe((event) => { /* react */ });
```

## Sagas (process managers)

Long-running handlers that react to domain events with side effects (cross-module cleanup, coordination, external integration), bridging the event stream to infrastructure actions. They live in `sagas/` of the module that owns the reaction (`modules/orders/sagas/inventory-reservation.ts`); sagas spanning several modules or no single context may live outside modules (a `workers` package such as `packages/workers/src/order-lifecycle.ts`, or a top-level `sagas/`).

```typescript
// modules/shipping/sagas/order-fulfillment.ts
export function startOrderFulfillmentSaga(deps: { shippingService: ShippingService }): Subscription {
  return events$().pipe(
    ofType<OrderPlaced>(EventType.OrderPlaced),
    mergeMap(async (event) => {
      await deps.shippingService.createShipment(event.orderId, event.items);
    }),
  ).subscribe();
}
```

Rules: sagas own side effects (I/O, infrastructure cleanup, external calls); return a subscription handle for teardown on shutdown; receive dependencies by injection (same factory pattern as services); are resilient (log and continue, never crash the process); start at boot from the composition root or server setup.

| Use a **service** when… | Use a **saga** when… |
|---|---|
| part of the primary request/response flow | reacting to something that already happened |
| the caller needs the result | fire-and-forget |
| the logic belongs to one bounded context | the reaction crosses contexts |

## Dependency direction

```
orders  ──emits──▶  OrderPlaced
                         ▲
shipping ──subscribes────┘
```

The publisher knows nothing about subscribers; the subscriber depends one way on a stable contract (the event shape from `orders/index.ts`), not on implementation.
