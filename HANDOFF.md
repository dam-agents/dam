## Hibernation Discoverability — Handoff

**Ticket:** #3477
**Branch:** `worktree-feat+never-hibernate-discovery`
**Status:** Handed off to dev
**Date:** 2026-09-09

### What's in this branch

Interactive prototype making the `hibernationTimeoutMin: 0` (always on) feature discoverable. Run with `VITE_MOCK=true` on port 5179.

### Changes index (also visible in-app via the floating button)

1. **Compute Widget Always On Hover** — Home page, hover over idle agent slots
2. **Startup overlay with always on prompt** — Opens a starting agent, shows "keep always on" button with confirmation
3. **Setup - Lifecycle** — New agent creation page, lifecycle section with Power icon toggle
4. **Configure page - Lifecycle** — Agent settings, lifecycle section

### Key decisions in the prototype

- Power icon (not Lightning) for always on
- "Always on" without hyphen everywhere
- Idle (Always on) badge is blue (accent), Working (Always on) is green (success)
- Default hibernate timeout is 60 minutes
- HoverCard on all compute widget slots (not Tooltip) — bold name + specs
- Always on HoverCard adds subtitle + right-aligned "Manage" link
- Startup overlay stays visible after confirming always on (no redirect to chat)
