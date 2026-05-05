# ADR-028: Configurable injection on generic secrets

**Date:** 2026-04-21
**Status:** Accepted
**Owner:** @tomas2d

## Context

OneCLI's credential gateway (ADR-005) injects a stored token into outbound traffic by matching a secret's `hostPattern` against the request host and rewriting a predetermined header. Until now, only two knobs were surfaced on generic secrets: the secret name and the host pattern. Injection was effectively hardcoded: `Authorization: Bearer {value}` on every request to that host. Anthropic had a separate provider-shaped path; everything else was forced into the one-size-fits-all default.

That shape stops working as soon as a real provider deviates from it. Internal gateways (RITS, Portkey, and friends) commonly do one or more of:

- Use a non-`Authorization` header (e.g. `RITS_API_KEY`, `x-portkey-api-key`, `x-api-key`).
- Require a different value format (raw token, `Token {value}`, something else).
- Multiplex models or tenants behind one host where a single credential should only apply to a sub-path.

Each of those is a one-line platform patch in isolation, but cumulatively they push the system toward "one bespoke code path per provider" — work the user can declare themselves if we expose what OneCLI already supports.

## Decision

Extend the generic-secret schema with one scope knob and one full injection override. Keep Anthropic special-cased; this decision is only about generic secrets.

### 1. `pathPattern` (optional)

Narrow a secret's scope from "whole host" to "prefix on host". `hostPattern: api.example.com`, `pathPattern: /v1/*` only matches requests whose path falls under that prefix. Clearing the field on update sends `null` to OneCLI, which drops the path filter.

### 2. `injectionConfig` (optional)

A pair `{ headerName, valueFormat? }`. `headerName` is the HTTP header OneCLI rewrites; `valueFormat` is a template where the literal token `{value}` is replaced with the secret. Examples: `{ headerName: "RITS_API_KEY", valueFormat: "{value}" }`, `{ headerName: "x-api-key" }` (valueFormat defaults to `{value}`), `{ headerName: "Authorization", valueFormat: "Token {value}" }`.

Omitting the field falls back to a single platform default, `{ headerName: "Authorization", valueFormat: "Bearer {value}" }`, exported once and consumed by the server fallback and the UI placeholder so "default" cannot drift between them.

### 3. Anthropic restrictions stay explicit

Anthropic secrets are rejected by the tRPC router if they carry any of `hostPattern`, `pathPattern`, or `injectionConfig`. Enforced in a single validation pass so the UI gets every violation in one response. Anthropic's OAuth/API-key shape (ADR-024) is orthogonal to this decision.

### 4. Null-clear semantics on update

An update payload distinguishes between *unchanged* (field omitted) and *cleared* (field set to `null`). Applied uniformly to `pathPattern` and `injectionConfig`. Keeps the PATCH surface composable and avoids a separate "reset" endpoint.

## Alternatives Considered

**Per-provider hardcoded configs in the gateway.** Add a code path per new provider (one for Anthropic, one for RITS, one for Portkey, …). Rejected: the gateway already supports arbitrary header rewrites; this is platform work that grows linearly with providers, for something users can express declaratively.

**Free-form headers JSON instead of `{ headerName, valueFormat }`.** Let users paste an arbitrary header map. Rejected: hard to validate, no `{value}` contract, and 95% of real cases are a single header with a formatted value. The two-field shape captures the common case without closing the door on a future multi-header form.

**Per-secret sentinel matching.** Assign each secret a unique sentinel (`platform:sentinel:<id>`) and have OneCLI match on sentinel instead of host+path. Rejected: host+path matching is already how OneCLI works and covers this use case; per-secret sentinels would require a gateway change and touch every code path that currently emits the shared sentinel.

**Push path scoping into the agent (rewrite requests in `agent-runtime`).** Rejected: the gateway already sits inline and MITMs the traffic; adding path scoping on the agent side would split one concern across two codebases.

## Consequences

- Generic secrets cover providers the platform previously couldn't support, with no per-provider code. First concrete example shipped in the same PR: the pi-agent RITS extension (`packages/agents/pi-agent/README.md`) uses `headerName: RITS_API_KEY`, `valueFormat: {value}`, and a host+path pattern scoped to one model URL.
- The "default injection" is now a shared constant. A future change (e.g. lowercasing the header name) is a one-line edit; today's UI placeholder mirrors whatever the server falls back to.
- The update PATCH surface grows two optional fields, plus `null`-clear semantics. Callers that only ever touch `name` or `value` are unaffected.
- Anthropic secrets and generic secrets drift further apart in schema shape. The router enforces the split; UI renders them with different forms. This is a deliberate trade — the Anthropic shape captures provider-specific constraints (OAuth vs API key) that don't generalize.
- Depends on OneCLI already accepting `pathPattern` and `injectionConfig` in `Secret.metadata` (same JSONB column used by `envMappings` from ADR-024). No OneCLI fork change was needed beyond that prior patch.
