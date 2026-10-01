# 04 — `dam-invoke` skill leads with the tools

**Depends on:** 01-sub-agent-tools, 02-wake-on-outcome
**Part of:** Spawn a sub-agent through a tool call — see [README](./README.md)

## Context

The `dam-invoke` skill ships in the Claude Code image and teaches only the script path.
With the tools in place it should lead with them for a single hand-off and keep scripts
for orchestration: loops, wide fan-outs, scoring. The tool descriptions stay complete on
their own, since other harnesses do not get the skill.

## Implementation plan

1. Rewrite the top of
   `packages/agents/claude-code/rootfs/app/working-dir/.agents/skills/dam-invoke/SKILL.md`:
   - Update the frontmatter `description` so it triggers on hand-off requests too, and add
     the platform MCP tools to `allowed-tools`.
   - New first section, "Your harness's subagent or an invoked agent": the need-based rule
     from the README, worded the same as `invoke_agent`'s description.
   - New section, "Hand off with a tool": `list_harnesses` / `list_connections` first
     (ask the human when unclear, as today), `invoke_agent`, `await_invocations` in a
     loop with the still-running ids, and that ending the turn is fine because the
     outcome arrives as a new turn.
   - Keep "The SDK", the setup options table, `ttl_ms`, failures, schema shorthand, and
     fan-out under a heading that says scripts are for orchestration. State that the
     options table applies to both surfaces.
2. Check whether `packages/agents/base/rootfs/usr/local/share/dam-skill-manifest.json`
   holds a hash or version of the skill that must be regenerated, and regenerate it with
   its mise task if so.

## Acceptance criteria

- [ ] The skill leads with the tool path and the need-based rule.
- [ ] Every setup option is documented once and applies to both surfaces.
- [ ] The skill manifest matches the skill, if it tracks one.
- [ ] `mise run check` passes.

## Smoke test

`mise run check`. Then on the local cluster with the rebuilt Claude Code image: ask an
agent "delegate computing 6 * 7 to a sub-agent" and check it uses `invoke_agent`, not a
script. Ask "run this 20-item eval loop on sub-agents and score each" and check it writes
a script.
