---
id: 022
title: "Harness API server — separate port with restricted API surface"
status: accepted
subsystem: agent-lifecycle
summary: Run a second HTTP server on port 4001 in the API server process exposing only trigger and MCP endpoints reachable by agent pods.
---
# ADR-022: Harness API server — separate port with restricted API surface

**Date:** 2026-04-17
**Status:** Accepted
**Owner:** @tomkis

## Context

Agent harnesses (Claude Code, Codex, etc.) running inside pods need to call back to the API server for two things: posting trigger results and connecting to MCP tools. The main API server (port 4000) serves the UI and exposes the full API behind Keycloak auth. Allowing harnesses to reach that port would give them access to the entire API surface — user management, instance CRUD, secrets — far more than they need.

The existing NetworkPolicy already restricted agent pod egress to a second port (originally for MCP only), so the infrastructure for a separate port was in place.

## Decision

Run a second HTTP server (the "harness API server") on port 4001 inside the same API server process. This server exposes only the endpoints that agent harnesses need:

- `POST /internal/trigger` — trigger session creation after a scheduled cron fires
- `ALL /api/instances/:id/mcp` — MCP tool access (e.g. Slack outbound)

The main API server on port 4000 remains unchanged and is not reachable from agent pods. The NetworkPolicy egress rule only opens port 4001 toward the apiserver component.

Code structure: `apps/api-server/` owns the user-facing server, `apps/harness-api-server/` owns the harness-facing server, and `index.ts` wires shared dependencies and starts both.

## Alternatives Considered

- **Single port with path-based auth**: use middleware to distinguish harness vs user requests. Rejected — harder to audit, easy to accidentally expose new endpoints to harnesses.
- **Open port 4000 in NetworkPolicy**: simplest change but grants harnesses access to the full API surface, violating least-privilege.

## Consequences

- Agent pods can only reach the explicitly exported harness API, not the full user-facing API.
- Adding a new harness-facing endpoint requires mounting it on the harness router — secure by default.
- Two servers share one process, so no extra deployment or resource overhead.
