# ADR-037: Remote terminal — split "chat" and "terminal" session modes

**Date:** 2026-05-04
**Status:** Accepted
**Owner:** @JanPokorny

## Context

Platform's only UI is the web app ([ADR-013](013-ui-approach.md), [ADR-020](020-responsive-ui-pwa.md)). We want to provide a replacement for locally installed harnesses (`claude` etc.) that provides Platform features like sandboxing and credential management, while preserving the familiar UX.

## Decision

**TTY relay runs locally, connects through Platform to remote PTY, in which a real harness TUI renders.** Does not match current ACP-based model, bringing some challenges. Harnesses can't run in TUI mode and ACP mode at the same time -- we must pick deliberately. Sessions now have modes: "chat" starts the harness in ACP mode (what we have now), "terminal" starts the harness in TUI mode against a PTY allocated in the agent pod.

Initially we deliver an alternative to the current chat view in the web app -- a web-based terminal emulator rendering a harness TUI. This may seem superficial given the stated use-case, but allows us to deliver a full vertical without needing to tackle CLI complexities (interface, auth, signal handling, port forwarding, file sync, etc.). Follow-up ADR will design a CLI reusing the same communication interface.

## Considerations

- Terminal emulators have various features that need to be communicated to the harness by env vars, otherwise they fall back to simpler UI. These need to be identified and verified with supported harnesses.
- Switching the session type requires harness restart, only possible cleanly if agent is idle.

## Alternatives considered

- **Harness runs locally, connects through Platform**: No runtime sandboxing = not suitable.
- **Custom TUI renderer runs locally, connects through Platform to ACP agents**: Heavy CLI implementation. Hard to keep in sync with harness capabilities. ACP may not expose every feature. Would never 100% match the original UX.
