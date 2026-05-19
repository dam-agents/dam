---
name: typescript-engineering
description: >
  Opinionated architecture for TypeScript client-server projects. Stack is tRPC,
  Zod, strict TypeScript, pnpm, RxJS, Hono or Express. Code is organized as a
  monorepo with modules as bounded contexts and a three-layer slice (services,
  domain, infrastructure) per module. Use this skill whenever the user is doing
  TypeScript client-server work, designing a feature, adding or modifying a
  module, deciding where code belongs, structuring packages, wiring cross-module
  communication, reviewing a design choice, or making any architectural call
  about layers, ports, events, or dependency direction. Triggers on phrases like
  "design this feature", "where should this live", "what module", "is this the
  right layer", "should this go in domain", "how do these modules talk",
  "review this architecture", "is this code clean", plus explicit references to
  tRPC architecture, bounded contexts, hexagonal architecture, ports and
  adapters, or DDD in a TS context.
---

# TypeScript Engineering

Opinionated architecture for TypeScript client-server projects, built for long-term maintenance.

## Step 1 — Identify Intent

Pick one mode. Default to asking only if it is genuinely ambiguous.

| Mode | Signal |
|------|--------|
| **design** | "design this", "spec this", "what modules", "how should I structure", "architect", "where would X go" without an existing file in hand. High-level shape. |
| **code** | The user is writing or modifying a specific file or feature. "add a service for X", "wire this up", "implement Y", "is this right" with a file open. |
| **review** | "review", "audit", "check architecture", "is this codebase clean", "what's wrong with this", looking at an area or the whole project. |

Code and design overlap when designing a small feature in-place. Code and review overlap when auditing one file. Pick the dominant intent and announce it in one sentence so the user can redirect.

## Step 2 — Load the Mode

Read the file for the chosen mode. Do not load the others.

- design → [modes/design.md](modes/design.md)
- code → [modes/code.md](modes/code.md)
- review → [modes/review.md](modes/review.md)
