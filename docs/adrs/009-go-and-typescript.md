---
id: 009
title: Go for Controller, TypeScript for API Server
status: accepted
subsystem: platform-topology
summary: Write the Controller in Go for client-go and operator tooling, and the API Server in TypeScript to share toolchain and types with the React UI.
---
# ADR-009: Go for Controller, TypeScript for API Server

**Date:** 2026-04-02
**Status:** Accepted
**Owner:** @jezekra1

## Context

The platform has two server-side components: the Controller (K8s reconciler + scheduler) and the API Server (REST/WebSocket layer). The team needed to choose languages for each. Python was the team's primary expertise. Go and TypeScript were the other candidates.

The Controller's main job is watching ConfigMaps and reconciling K8s resources — deep Kubernetes API integration. The API Server's main job is REST CRUD, WebSocket relay to agent pods, and serving the React UI — a web-native workload.

## Decision

Go for the Controller. TypeScript for the API Server.

**Controller in Go:**
- `client-go` is the first-class Kubernetes client library — every K8s feature is available, well-tested, and documented
- Single-binary deployment (no runtime dependencies)
- Clean upgrade path to a full K8s operator (kubebuilder/operator-sdk are Go-native)
- Strong concurrency model for watching multiple resource types

**API Server in TypeScript:**
- Shares the ecosystem with the React UI (one toolchain for the web layer)
- Leverages existing ACP SDK integration from the prototype phase
- WebSocket-native — Node.js excels at long-lived connection handling
- tRPC for type-safe API layer between UI and server

## Alternatives Considered

**Python for both.** Team's strongest language. Rejected for the Controller: the Python K8s client (`kubernetes-client/python`) is an auto-generated wrapper around the OpenAPI spec — less ergonomic, less documented, and no operator framework comparable to kubebuilder. Viable for the API Server but loses the shared-toolchain benefit with the React UI.

**Go for both.** Rejected for the API Server: Go's WebSocket ecosystem is functional but less ergonomic than Node.js for long-lived connections. Loses type sharing with the React frontend. The team has less Go experience, so concentrating Go in the smaller, more focused component (Controller) limits risk.

**TypeScript for both.** Rejected for the Controller: no first-class K8s operator framework. The JavaScript K8s client exists but lacks the maturity and community of `client-go`. Would make a future operator migration harder.

## Consequences

- Two languages in the repo — developers need familiarity with both Go and TypeScript
- Controller benefits from Go's K8s ecosystem and can evolve into a proper operator
- API Server benefits from type sharing with the UI via tRPC
- Build tooling must handle both ecosystems (Go module + pnpm workspaces)
- The boundary between Controller and API Server is clean (ConfigMaps are the interface), so the language split doesn't create coupling
