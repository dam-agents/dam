# Infrastructure Layer

The infrastructure layer implements the Ports & Adapters pattern. Inner layers (domain and services) define port interfaces describing what they need. The infrastructure layer provides concrete adapters that fulfill those ports.

## Repository Pattern

Repositories abstract data access behind domain-oriented interfaces. The service layer depends on the repository interface (port), never on the storage implementation.

### Defining a Repository Interface

```typescript
// modules/orders/infrastructure/OrdersRepository.ts
export interface OrdersRepository {
  list(owner: string): Promise<Order[]>;
  get(id: string, owner: string): Promise<Order | null>;
  create(input: CreateOrderInput, owner: string): Promise<Order>;
  update(id: string, owner: string, patch: Partial<OrderSpec>): Promise<Order | null>;
  delete(id: string, owner: string): Promise<void>;
}
```

Repository interfaces live in `infrastructure/` as type definitions. They speak the domain language — method names reflect domain operations, not storage operations.

### Implementing a Repository

```typescript
// modules/orders/infrastructure/createOrdersRepository.ts
export function createOrdersRepository(db: Database): OrdersRepository {
  return {
    async list(owner) {
      const rows = await db.query('SELECT * FROM orders WHERE owner = ?', [owner]);
      return rows.map(parseOrder);
    },
    async get(id, owner) {
      const row = await db.queryOne('SELECT * FROM orders WHERE id = ? AND owner = ?', [id, owner]);
      return row ? parseOrder(row) : null;
    },
    // ...
  };
}
```

The concrete implementation is a factory function that returns the interface. Storage details (SQL, ConfigMaps, HTTP calls) are encapsulated here. The service layer never sees them.

### Rich Repository Operations

Repositories can expose domain-meaningful operations beyond basic CRUD:

```typescript
export interface InstancesRepository {
  list(owner?: string): Promise<InfraInstance[]>;
  get(id: string, owner?: string): Promise<InfraInstance | null>;
  create(agentId: string, spec: Record<string, unknown>, owner: string): Promise<InfraInstance>;
  wake(id: string): Promise<void>;
  isOwnedBy(id: string, owner: string): Promise<boolean>;
  isPodReady(id: string): Promise<boolean>;
}
```

Operations like `wake()` or `isPodReady()` reflect domain concepts, not storage primitives.

## Mappers

Mappers are pure functions that translate between infrastructure representations and domain objects. They live in `infrastructure/` alongside the repository implementations.

```typescript
// modules/orders/infrastructure/mappers.ts

// Infrastructure → Domain (parse)
function parseOrder(row: OrderRow): Order {
  return {
    id: row.id,
    status: computeOrderStatus(row),
    items: JSON.parse(row.items_json),
  };
}

// Domain → Infrastructure (build)
function buildOrderRow(order: CreateOrderInput, owner: string): OrderRow {
  return {
    id: generateId('order'),
    owner,
    items_json: JSON.stringify(order.items),
    status: 'pending',
  };
}
```

Mappers are **unidirectional**: parse functions go from infrastructure to domain, build functions go from domain to infrastructure. They handle format differences, serialization, and structural mapping.

### Mutation Helpers

For partial updates, mappers can provide immutable patch functions:

```typescript
function patchSpecField(existing: ConfigMap, field: string, value: unknown): ConfigMap {
  const spec = parseYaml(existing.data['spec.yaml']);
  return { ...existing, data: { ...existing.data, 'spec.yaml': toYaml({ ...spec, [field]: value }) } };
}
```

## External System Adapters

For external systems beyond storage (message queues, third-party APIs, platform services), define a port interface and provide an adapter:

```typescript
// Port interface
export interface NotificationSender {
  send(userId: string, message: string): Promise<void>;
}

// Adapter implementation
export function createSlackNotificationSender(client: SlackClient): NotificationSender {
  return {
    async send(userId, message) {
      await client.chat.postMessage({ channel: userId, text: message });
    },
  };
}
```

Services depend on `NotificationSender`, not on Slack. Swapping the notification channel means writing a new adapter, not changing any service code.

## Dependency Injection via Service Factories

Services receive their dependencies (repositories, adapters, configuration) through factory functions. No DI container — explicit wiring at the composition root.

### Service Factory

```typescript
// modules/orders/services/OrdersService.ts
export function createOrdersService(deps: {
  repo: OrdersRepository;
  owner: string;
  notifier: NotificationSender;
}): OrdersService {
  return {
    async create(input) {
      const order = await deps.repo.create(input, deps.owner);
      emit({ type: 'OrderPlaced', orderId: order.id });
      await deps.notifier.send(deps.owner, `Order ${order.id} placed`);
      return order;
    },
    // ...
  };
}
```

The `deps` object is the constructor. All infrastructure is injected — the service only knows about port interfaces.

### Composition Root (`compose.ts`)

Each module has a `compose.ts` that wires infrastructure to services. This is the **only place** where concrete implementations are referenced:

```typescript
// modules/orders/compose.ts
export function composeOrdersModule(db: Database, slackClient: SlackClient, owner: string) {
  const repo = createOrdersRepository(db);
  const notifier = createSlackNotificationSender(slackClient);

  return {
    orders: createOrdersService({ repo, owner, notifier }),
  };
}
```

The composition root receives raw infrastructure dependencies (database connections, API clients) and returns fully wired services. See [modules.md](modules.md) for how this integrates with the module structure.

### Required Dependencies — Never Optional

Service dependencies are **required**, never optional. A dependency exists because the service genuinely needs it — there is no such thing as a dependency that is sometimes there and sometimes not. An optional dep (`notifier?: NotificationSender`) models a capability toggle as a wiring question, which is the wrong axis: it forces every call site to branch on presence (`if (deps.notifier) …`), hides a missing wiring as a silent skip instead of a type error, and leaves the reader unable to tell whether absence is intended or a bug.

The consuming service also stays out of the on/off question: it calls its dependency unconditionally. Whether a dependency does anything — and every other knob on its behavior — is **owned by that dependency** and configured where it is built, at the composition root. Don't hoist a dependency's configuration up into the consumer's `deps`; the consumer must not even know the capability is toggleable.

```typescript
// Bad — optional dep; the consumer carries a toggle that isn't its concern
export function createOrdersService(deps: {
  repo: OrdersRepository;
  notifier?: NotificationSender;
}) {
  return {
    async create(input) {
      const order = await deps.repo.create(input);
      if (deps.notifier) await deps.notifier.send(/* … */); // absence intended, or a wiring bug?
      return order;
    },
  };
}

// Good — required dep, called unconditionally; the consumer knows nothing about on/off
export function createOrdersService(deps: {
  repo: OrdersRepository;
  notifier: NotificationSender;
}) {
  return {
    async create(input) {
      const order = await deps.repo.create(input);
      await deps.notifier.send(/* … */);
      return order;
    },
  };
}
```

The on/off switch belongs to the sender, configured with the rest of its wiring at the root:

```typescript
// modules/orders/compose.ts — the sender owns its own config
const notifier = createSlackNotificationSender(slackClient, {
  enabled: config.notifyOnCreate,
});
return { orders: createOrdersService({ repo, owner, notifier }) };
```

The same rule covers tests: don't loosen a required dep to `optional` to ease setup — pass the real (or a stubbed) implementation.

## Multi-Storage Strategy

Different bounded contexts can use different storage backends. A repository for one module might use a SQL database while another uses an API or file system. The service layer does not care — it depends on the repository interface.

```typescript
// Agents module: backed by Kubernetes ConfigMaps
const agentsRepo = createAgentsRepository(k8sClient);

// Sessions module: backed by PostgreSQL
const sessionsRepo = createSessionsRepository(db);
```

This is a natural consequence of the repository pattern. Storage decisions are per-module, not global.
