# ADR-019: Responsive mobile UI, ACP session controls, PWA

**Status:** ACCEPTED
**Date:** 2026-04-16
**Owner:** @jezekra1

## Context

The Platform UI is desktop-only with a fixed 3-column layout. It doesn't work on mobile devices, has no stop/cancel button for running agent turns, and doesn't expose ACP session configuration (model, mode, effort, thinking) that the protocol already supports. Users who want to interact with agents from a phone cannot.

The ACP protocol (v0.17.0) and the Claude Code ACP harness (v0.24.2) already implement:
- `session/cancel` (stable) — cancel an active prompt turn
- `session/set_mode` (stable) — switch editing modes (ask, edit, plan)
- `session/set_config_option` (stable) — toggle effort, thinking, etc.
- `session/set_model` (unstable) — switch models
- Session responses return `modes`, `models`, and `configOptions` dynamically

The UI currently ignores all of these.

## Decision

### 1. Stop button as a state of the Send button

The Send button becomes a Stop button (square icon) when the agent is computing and the input is empty. When the user starts typing during computation, it becomes Send again to allow message queuing. Stop triggers `connection.cancel({ sessionId })`.

**Why not a separate button?** Matches the Claude Code IDE pattern (screenshot reference). Avoids cluttering the input area. The tri-state (idle/stop/queue) maps exactly to the three user intentions.

### 2. Dynamic ACP session controls inline with input

Mode selector and config options (effort, model, thinking) are shown below the textarea as a tappable label that opens a popover. All options are dynamically driven from ACP session state — the UI never hard-codes model names or config options.

**Why dynamic?** Different agent harnesses (Claude Code, Codex, Gemini CLI) expose different capabilities. Hard-coding would break when harnesses change or when non-Claude agents are used.

### 3. Right panel consolidated to 3 tabs

The current 5 tabs (files, log, schedules, channels, mcps) are consolidated to 3 (files, log, configuration). The configuration tab holds schedules, channels, MCPs as collapsible sections.

**Why consolidate?** 5 tabs don't fit on narrow screens. Schedules/channels/mcps are all "instance configuration" — grouping them reflects their shared purpose.

### 4. Mobile: two-screen chat pattern

On mobile (<768px), ChatView uses a two-screen flow: session list (full screen) → chat (full screen). The right panel becomes a full-screen overlay behind a "config" button. No side-by-side panels on mobile.

**Why two-screen, not drawers?** Mobile users need full-width for both session selection and chat. Drawers partially occlude content and create awkward touch targets. A clean screen transition is simpler and more native-feeling.

### 5. PWA with service worker

Add a web app manifest and minimal service worker for app shell caching. This allows mobile users to install Platform to their home screen and get a standalone app experience. No offline data — WebSocket and API are online-only.

### 6. Lobster logo

A stylized lobster logo in the brutalist warm aesthetic (geometric/minimal, orange/amber). Serves as favicon, PWA icon, and nav bar brand mark, replacing the current lucide ShellIcon.

## Consequences

- **UI-only change** — no server, controller, or agent-runtime modifications
- **ACP relay unchanged** — the API server's WebSocket proxy passes all new ACP methods transparently
- **Unstable API risk** — `unstable_setSessionModel` may change in future ACP SDK versions. The UI should handle its absence gracefully (hide the model selector if `models` is null in session response).
- **PWA caching** — service worker must be carefully scoped to avoid caching API responses or stale auth tokens
- **Mobile testing** — requires testing on actual mobile devices/emulators, not just browser resize
