# Layered Architecture

The architecture follows a strict three-layer model inspired by Domain-Driven Design and Hexagonal Architecture (Ports & Adapters). Dependencies flow inward — toward the domain. Infrastructure sits outside the domain, implementing ports defined by inner layers.

These layers exist **within each module in server packages** — where actual business logic lives. The server is organized into modules, where each module is a vertical slice representing a bounded context (see [modules.md](modules.md)). The layers below live inside every server-side module.

**Note:** API contract packages do not use this layered structure. Contract packages have a flat module structure (types + router) that defines *what* the API exposes — including input validation via Zod schemas. The three-layer stack described here defines *how* the server implements it. See [modules.md](modules.md) for the distinction between module definition and module implementation.

**Validation lives in the contract package.** The tRPC routers in the contract package handle input validation (Zod schemas), parse and sanitize external input, and delegate to the service interface. The server package implements that service interface — it does not contain its own routers.

```
  External input
       │
       ▼
┌──────────────────────┐
│  Validation Layer    │  tRPC routers + Zod schemas
│  (contract package)  │  Parse, validate, sanitize — no business logic
└──────────┬───────────┘
           │ delegates to service interface
           ▼
┌──────────────────────┐
│  Application Layer   │  Business services (implements service interface)
│  (services/)         │  Orchestrate use cases, coordinate domain objects
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Domain Layer        │  Pure TypeScript — zero external deps
│  (domain/)           │  Entities, value objects, aggregates, domain events
└──────────────────────┘
           ▲
           │ implements ports
┌──────────┴───────────┐
│  Infrastructure Layer│  Adapters for external systems
│  (infrastructure/)   │  Repositories, mappers, external service clients
└──────────────────────┘
```

## Layer Rules

### Validation Layer (contract package — not in server modules)

- tRPC routers in the **contract package** define the API surface and handle input validation via Zod schemas.
- Responsible for parsing, validating, and sanitizing external input.
- **No business logic lives here** — routers delegate immediately to the service interface.
- The server package implements the service interface; it does not contain routers.
- Each router file maps to a resource within the module's bounded context.

### 1. Application Layer (`services/`)

- Business services orchestrate use cases and coordinate domain objects.
- Services receive dependencies (including infrastructure ports) via injection — see [infrastructure.md](infrastructure.md) for the factory pattern.
- Translates between the outside world and the domain — mapping validated input into domain operations and domain results back into API responses.
- Transaction boundaries and cross-cutting concerns (logging, auth checks) live here.
- Services emit domain events when meaningful state changes occur.

### 2. Domain Layer (`domain/`)

- The innermost layer — pure TypeScript with **zero external dependencies**.
- Contains domain entities, value objects, aggregates, and domain events.
- All business rules and invariants are enforced here.
- Domain logic is pure and deterministic — no side effects, no I/O, no framework imports.
- Assembly functions compute domain state from raw data (e.g., combining infrastructure state with application state into a rich domain object).
- Use `Result` types to represent domain errors as values, not thrown exceptions.
- The domain layer never imports from any other layer.

### 3. Infrastructure Layer (`infrastructure/`)

- Implements ports (interfaces) that services depend on — repositories, external system adapters, clients.
- Contains storage-specific logic: mappers that translate between domain objects and persistence formats.
- **The domain and services define what they need (ports); infrastructure provides it (adapters).**
- Infrastructure may import from the domain layer (to implement ports and map types) but never from services.
- See [infrastructure.md](infrastructure.md) for patterns: repositories, mappers, adapters.

## Dependency Rule

Dependencies flow strictly inward, with infrastructure implementing ports from inner layers:

```
services → domain ← infrastructure
```

- **contract routers** delegate to the service interface — they live in the contract package, not in the server.
- **services** may import from domain only. Services receive infrastructure via dependency injection (they depend on port interfaces, not concrete implementations).
- **domain** imports from nothing outside itself.
- **infrastructure** may import from domain (to implement port interfaces and map types).

Violating this rule (e.g., a domain entity importing from a service, or a service importing an infrastructure implementation directly) is always an error.

## Error Handling

- Domain errors are represented as `Result<T, E>` values — never thrown exceptions.
- Services unwrap or propagate `Result` types.
- Contract routers translate domain errors into appropriate tRPC error codes.
