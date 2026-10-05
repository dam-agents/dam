# Layered Architecture

A strict three-layer model after DDD and Hexagonal Architecture (Ports & Adapters): dependencies flow inward toward the domain; infrastructure sits outside and implements ports the inner layers define.

The layers live **inside each module of a server package**, where business logic lives (each module is a vertical slice for one bounded context, [modules.md](modules.md)). API contract packages don't use them: their flat modules (types + router) define *what* the API exposes, including Zod input validation; these layers define *how* the server implements it.

```
  External input
       │
       ▼
┌──────────────────────┐
│  Validation Layer    │  tRPC routers + Zod schemas
│  (contract package)  │  parse, validate, sanitize; no business logic
└──────────┬───────────┘
           │ delegates to service interface
           ▼
┌──────────────────────┐
│  Application Layer   │  business services (implement the service interface)
│  (services/)         │  orchestrate use cases, coordinate domain objects
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  Domain Layer        │  pure TypeScript, zero external deps
│  (domain/)           │  entities, value objects, aggregates, domain events
└──────────────────────┘
           ▲ implements ports
┌──────────┴───────────┐
│  Infrastructure      │  adapters for external systems
│  (infrastructure/)   │  repositories, mappers, external clients
└──────────────────────┘
```

## Layer Rules

**Validation (contract package, not server modules).** tRPC routers define the API surface and parse, validate and sanitize input with Zod, then delegate immediately to the service interface; no business logic. One router file per resource of the module's bounded context. The server implements the interface and has no routers of its own.

**1. Application (`services/`).** Services orchestrate use cases and coordinate domain objects. They get dependencies, including infrastructure ports, by injection ([infrastructure.md](infrastructure.md)). They map validated input into domain operations and domain results back into responses, own transaction boundaries and cross-cutting concerns (logging, auth checks), and emit domain events on meaningful state changes.

**2. Domain (`domain/`).** The innermost layer: pure TypeScript, **zero external dependencies**, imports from no other layer. Entities, value objects, aggregates, domain events; every business rule and invariant is enforced here. Logic is pure and deterministic (no side effects, I/O or framework imports). Assembly functions compute rich domain state from raw data (e.g. infrastructure state + application state). Domain errors are `Result` values, not exceptions.

**3. Infrastructure (`infrastructure/`).** Implements the ports services depend on (repositories, external adapters, clients) and holds storage-specific mappers between domain objects and persistence formats. **Inner layers define what they need (ports); infrastructure provides it (adapters).** It may import from domain (to implement ports and map types), never from services. Patterns: [infrastructure.md](infrastructure.md).

## Dependency Rule

```
services → domain ← infrastructure
```

- Contract routers delegate to the service interface and live in the contract package.
- Services import only from domain; they receive infrastructure by injection, depending on port interfaces, never implementations.
- Domain imports nothing outside itself.
- Infrastructure may import from domain.

Any violation (a domain entity importing a service, a service importing an infrastructure implementation) is always an error.

## Error Handling

Domain errors are `Result<T, E>` values, never thrown. Services unwrap or propagate them; contract routers translate them into tRPC error codes.
