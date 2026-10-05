# Infrastructure Layer

Ports & Adapters: domain and services define port interfaces for what they need; infrastructure provides concrete adapters.

## Repositories

Repositories hide data access behind domain-oriented interfaces; services depend on the interface (port), never the storage. Interfaces live in `infrastructure/` as types and speak the domain language: method names are domain operations, not storage operations.

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

The implementation is a factory returning the interface; storage details (SQL, ConfigMaps, HTTP) stay inside it.

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

Repositories may expose domain operations beyond CRUD (`wake()`, `isPodReady()` are domain concepts, not storage primitives):

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

Storage is chosen per module, not globally: one module's repository may use SQL, another an API, ConfigMaps or files; services don't care.

```typescript
const agentsRepo = createAgentsRepository(k8sClient);
const sessionsRepo = createSessionsRepository(db);
```

## Mappers

Pure, **unidirectional** functions in `infrastructure/` next to the repositories: parse (infrastructure → domain) and build (domain → infrastructure), handling format, serialization and structure.

```typescript
// modules/orders/infrastructure/mappers.ts
function parseOrder(row: OrderRow): Order {
  return { id: row.id, status: computeOrderStatus(row), items: JSON.parse(row.items_json) };
}

function buildOrderRow(order: CreateOrderInput, owner: string): OrderRow {
  return { id: generateId('order'), owner, items_json: JSON.stringify(order.items), status: 'pending' };
}
```

Partial updates use immutable patch helpers:

```typescript
function patchSpecField(existing: ConfigMap, field: string, value: unknown): ConfigMap {
  const spec = parseYaml(existing.data['spec.yaml']);
  return { ...existing, data: { ...existing.data, 'spec.yaml': toYaml({ ...spec, [field]: value }) } };
}
```

## External System Adapters

For non-storage systems (queues, third-party APIs, platform services), define a port and an adapter. Services depend on the port; switching channels means a new adapter, no service changes.

```typescript
export interface NotificationSender {
  send(userId: string, message: string): Promise<void>;
}

export function createSlackNotificationSender(client: SlackClient): NotificationSender {
  return {
    async send(userId, message) {
      await client.chat.postMessage({ channel: userId, text: message });
    },
  };
}
```

## Dependency Injection via Service Factories

No DI container: services get repositories, adapters and config through a factory's `deps` object, wired explicitly at the composition root. Services know only port interfaces.

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

Each module's `compose.ts` is the **only place** concrete implementations are referenced: it takes raw dependencies (DB connections, API clients) and returns wired services ([modules.md](modules.md)).

```typescript
// modules/orders/compose.ts
export function composeOrdersModule(db: Database, slackClient: SlackClient, owner: string) {
  const repo = createOrdersRepository(db);
  const notifier = createSlackNotificationSender(slackClient);
  return { orders: createOrdersService({ repo, owner, notifier }) };
}
```

### Dependencies are required, never optional

A dependency exists because the service needs it. An optional dep (`notifier?: NotificationSender`) turns a capability toggle into a wiring question: every call site branches on presence (`if (deps.notifier) …`), a missing wiring becomes a silent skip instead of a type error, and readers can't tell intended absence from a bug.

The consumer calls its dependency unconditionally and doesn't know the capability is toggleable. Whether the dependency does anything, like every other knob on it, is **owned by the dependency** and configured where it is built, at the composition root; never hoist it into the consumer's `deps`.

```typescript
// Bad: optional dep, the consumer carries a toggle that isn't its concern
export function createOrdersService(deps: { repo: OrdersRepository; notifier?: NotificationSender }) {
  return {
    async create(input) {
      const order = await deps.repo.create(input);
      if (deps.notifier) await deps.notifier.send(/* … */);
      return order;
    },
  };
}

// Good: required dep, called unconditionally
export function createOrdersService(deps: { repo: OrdersRepository; notifier: NotificationSender }) {
  return {
    async create(input) {
      const order = await deps.repo.create(input);
      await deps.notifier.send(/* … */);
      return order;
    },
  };
}

// modules/orders/compose.ts: the sender owns its on/off switch
const notifier = createSlackNotificationSender(slackClient, { enabled: config.notifyOnCreate });
return { orders: createOrdersService({ repo, owner, notifier }) };
```

Tests too: don't loosen a required dep to optional for easier setup; pass a real or stubbed implementation.
