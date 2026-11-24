# 12 — Docs, profiles and end-to-end

**Depends on:** 07, 08, 09, 10, 11
**Part of:** MCP tool approval — see [README](./README.md), section "Second round"

## Context

Slices 07 to 11 change code only, so their folders do not overlap.
This slice brings the architecture pages, the glossary, the QA profile and the end-to-end helpers in line with them.

## Implementation plan

Follow [documentation guidelines](../../guidelines/documentation-guidelines.md); one sentence per line, then `mise run fix:markdown`.

1. **Architecture pages.**
   [connections.md](../../architecture/connections.md): the tool mode paragraphs become tool access on the grant, the three rules, the two groups with exceptions, what a new grant starts with, the strictest rule for an unnamed request, and the Connection-wide choice while the feature is off.
   [security-and-credentials.md](../../architecture/security-and-credentials.md) (the tool access step), [slack-guarantees.md](../../architecture/slack-guarantees.md), [mcp-connections.md](../../architecture/mcp-connections.md), [connection-presets.md](../../architecture/connection-presets.md) and [cli.md](../../architecture/cli.md).
   Update each page's `Last verified:` date.
2. **Glossary** ([ubiquitous-language.md](../../ubiquitous-language.md)).
   Tool access, tool rule, and what "tool mode" means now.
3. **QA profile** (`.quality-inspector/qi-profile-dam/`: `SKILL.md`, `scenarios/`, `suite/`).
   The Tool access dialog, the Agent's Connections row, the Connections page row and the approval card.
4. **Design profile** (`.design-desk/dam/`).
   Only if a screen moved or a `packages/ui` folder changed its role.
5. **End-to-end** (`packages/e2e`).
   Update the helpers and tests that set or read the mode (`playwright/src/lib/connections.ts`).
6. **This plan.**
   Rewrite the README's whole-feature smoke test for access per agent.

## Acceptance criteria

- [ ] No architecture page says a Connection has one mode for every Agent, except where it describes the feature-off choice.
- [ ] `mise run check:markdown` and `mise run check:comment-types` pass.
- [ ] `mise run check` passes for the packages the feature touches.
