# ADR-013: UI approach — chat-primary, dashboard for inspection

**Date:** 2026-04-07
**Status:** Accepted
**Owner:** @PetrBulanek

## Context

The platform needs a user interface. The team debated the primary interaction model: chat-driven everything (Tomas W.) vs. structured dashboard for complex agent management (Matous). A pre-PoC prototype exists (`packages/ui/`) — a monolithic React app with plain CSS that validates core patterns but is not production-ready.

Prior ADRs constrain parts of the stack: ADR-009 (TypeScript + tRPC for type-safe UI↔API communication), ADR-007 (ACP relay through API Server), ADR-004 (ACP protocol).

## Decision

**Chat-primary, dashboard for inspection and override.** Chat is where users work with agents — setting up schedules, updating identity files, configuring behavior. The dashboard provides structured views for inspecting what the agent did (workspace files, schedules, logs, approvals) and overriding when needed. Same principle as ADR-002: platform provides visibility and control surfaces, chat is where work happens.

**The web UI is not the only interaction channel.** Users can also interact with agents through external channels (Slack is the first target, required for Summit demo). Both the web UI and external channels are bidirectional — users can respond to agents on Slack, not just receive findings. The web UI surfaces external channel status but does not replicate external conversations.

**Custom React UI with a component library.** No existing UI (OpenClaw, ADK/Kagenti) fits — the platform is harness-agnostic. PatternFly is the leading component library candidate for pragmatic reasons (mature React components, Red Hat ecosystem alignment) but not locked in.

**Pencil for high-level design, code-first for iteration.** Wireframes (`docs/specs/ui/wireframes.pen`) and the UI spec (`docs/specs/ui/`) are structural drafts — they define layout, information architecture, and behavior, not visual treatment. The visual language comes from the chosen component library. Once the component system is established, new features follow a code-first approach; Pencil is used for new screens and significant layout changes.

**Pre-PoC prototype is not preserved as-is.** The rebuilt UI starts with proper architecture. Useful pieces (tRPC clients, ACP connection logic) may carry forward; the monolithic component structure and hand-rolled CSS will not.

**PoC scope.** Driven by the Red Hat Summit demo (2026-05-11). The PoC delivers chat and the minimum dashboard needed to run the demo end-to-end: agent catalog, agent creation, chat (including inline approval cards for human-in-the-loop decisions), workspace browsing, schedule/heartbeat visibility, logs, and read-only external channel status. Standalone approval queue, debug mode, and multi-user RBAC are deferred. Detailed scope is tracked in the UI spec (`docs/specs/ui/`).

**Lightweight test setup.** A testing framework is configured from the start but coverage must not slow delivery.

## Alternatives Considered

**Chat-only.** Cannot efficiently handle bulk operations (approval queues), spatial tasks (file tree browsing), or tabular data (schedule management).

**Dashboard-first with chat as a secondary view.** Inverts the priority — chat is the primary interaction, not a peer among management screens.

**CLI-only.** Doesn't serve consumption and approval use cases that need visual density.

**Extend an existing UI (OpenClaw, ADK/Kagenti).** Couples the interface to another project's assumptions. The platform supports multiple harnesses.

**No component library (plain CSS).** Too much effort reinventing standard components. A library accelerates delivery and provides accessibility out of the box.

## Consequences

- Chat carries most interaction weight — must be the most polished surface
- Dashboard views can be built incrementally as secondary surfaces
- Component library choice determines visual language — wireframes intentionally don't prescribe aesthetics
- PatternFly (if chosen) brings ecosystem alignment but also its visual opinions
- External channels (Slack, etc.) are potentionaly bidirectional — how they surface in the UI (as sessions, as status, or both) is deferred to the UI spec
