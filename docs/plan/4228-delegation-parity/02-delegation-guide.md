# 02 — One delegation guide for every harness

**Part of:** Delegation works the same on every harness — see [README](./README.md)

## Context

Every agent already gets the `spawn-subagent` skill, because the default image carries every harness's files.
But the skill's source lives in Claude Code's image folder, and parts of its advice work only on Claude Code.
It tells the agent to run a long fan-out script as a background task: Codex kills a background job at once, and Pi has no background jobs.
It also tells every agent to prefer its harness's own subagent, and Pi has none.
This slice moves the skill to the base image and rewrites it, the base `AGENTS.md` and the `spawn_subagent` description, so that every instruction holds on every harness.

## Implementation plan

Apply `/typescript-engineering` to step 4.

1. **Move the skill.**
   `git mv packages/agents/claude-code/rootfs/app/working-dir/.agents/skills/spawn-subagent packages/agents/base/rootfs/app/working-dir/.agents/skills/spawn-subagent`.
   The image path stays `/app/working-dir/.agents/skills/spawn-subagent`, and the directory name is the skill's identity, so an existing agent with an untouched copy gets the new text through image-skill reconciliation ([agent-skills](../../architecture/agent-skills.md#image-skill-lifecycle)).

2. **Rewrite the moved `SKILL.md`** so that no advice depends on one harness.
   Keep it a general guide: principles and non-obvious facts, not recipes for edge cases.
   Keep it as short as it is now, or shorter.
   - **Step 1, the decision:** use your harness's own subagent **if it has one**.
     If it has none and no need from the list applies, do the work yourself.
     The needs list and the "refused need" rules stay as they are.
   - **The tools are the default**, for one hand-off, for a fan-out (one `spawn_subagent` per task, then one `await_subagents` with all the ids), and for any wait that may be long.
     State the guarantee: if you stop waiting or end your turn, the platform delivers each result to this session as a new turn, on every harness.
   - **A script is for orchestration logic only** — loops, scoring one result with another — and it must finish inside one shell command.
     Run it in the foreground.
     State the limit plainly: a script's results reach nobody if the script stops early, because the platform delivers results as a turn only for tool spawns.
   - **Delete** the background advice: "run a long fan-out script as a background task," and any advice to detach a script with `&`, `nohup` or `setsid`.
     The fact that "you stay awake while your sub-agents run" stays.
   - **True state:** never tell the user that a sub-agent or a script runs unless you checked.
     `await_subagents`, or the script's own output, is the source of truth; a background shell job can die at once on some harnesses.
   - **Examples** use the harness as a variable, or name more than one harness.
     The per-harness model table stays: it already covers all four.
   - **Frontmatter:** rewrite the `description` the same way (drop "Its first step decides whether your harness's own subagent is enough" if it no longer fits).
     Keep `allowed-tools`: Claude Code reads it, and the other harnesses ignore it.

3. **Update the Shipped-Skill Manifest:** `mise run fix:skill-manifest` appends the new hash to [`dam-skill-manifest.json`](../../../packages/agents/base/rootfs/usr/local/share/dam-skill-manifest.json).

4. **Reword the other two places that state the rule.**
   - In the base [`AGENTS.md`](../../../packages/agents/base/rootfs/etc/AGENTS.md), the "Delegation:" paragraph (two sentences): the harness's own subagent, if it has one, works in this sandbox; the `spawn_subagent` tool starts a separate agent, for the listed needs.
     Keep it at two or three sentences.
   - In [`sub-agent-tools.ts`](../../../packages/api-server/src/apps/harness-api-server/sub-agent-tools.ts), `SPAWN_DESCRIPTION` ("This is not your harness's own subagent … prefer that whenever it can do the job"), the `needs` description and the refusal text: say "if your harness has one."
     Change no behavior.

5. **Docs.**
   In [`invocations.md`](../../architecture/invocations.md), section "Sub-agent tools", paragraph "The model is told when not to use it":
   - "Harnesses carry their own in-sandbox subagents" becomes: most harnesses do, and the description steers there only when the harness has one.
   - "The base image's instructions carry the same rule in two sentences, for the harnesses that get no skill" becomes: every harness gets the skill from the base image, and the base instructions repeat the rule.
   - Add one sentence: scripts wait in the foreground, and long waits use the tools, because only a tool spawn's result is delivered as a turn.

   Update `Last verified:`.
   Check [`agent-images.md`](../../architecture/agent-images.md) and [`agent-skills.md`](../../architecture/agent-skills.md) for a statement that the move makes wrong; change only what is wrong.
   Run `mise run fix:markdown`.

## Acceptance criteria

- [ ] The skill exists only under `packages/agents/base/rootfs/app/working-dir/.agents/skills/spawn-subagent/`, and `mise run check:skill-manifest` passes.
- [ ] The skill, the base `AGENTS.md` and `SPAWN_DESCRIPTION` contain no advice that only one harness can follow: no background-task advice, no `nohup`/`setsid`/`&` advice, and the own-subagent advice says "if it has one."
- [ ] The skill says that tool spawns get a result turn and script spawns do not.
- [ ] On each harness, the agent loads the skill when asked to delegate (check 4 of the README's smoke test).
- [ ] An agent created before the change shows the new skill text after it moves to the new image.
- [ ] `mise run //packages/api-server:check`, `mise run //packages/api-server:test`, `mise run check:comment-types` and `mise run fix:markdown -- --check` pass.

## Smoke test

1. `mise run check:skill-manifest` and `mise run //packages/api-server:test` pass.
2. `rg -n -i "background task|nohup|setsid|run_in_background" packages/agents/base/rootfs/app/working-dir/.agents/skills/spawn-subagent` prints nothing, and neither does the same search over the "Delegation:" paragraph of the base `AGENTS.md`.
   Its "Long jobs" paragraph keeps `nohup` and `setsid`: that advice is for `platform-keep`, not delegation, and holds on every harness.
3. Live, on a dev deployment built from the branch (`mise run cluster:build -- api-server agents`):
   - On an agent created **before** the rebuild, open its terminal: `~/.agents/skills/spawn-subagent/SKILL.md` has the new text.
   - On Codex, Pi and Bob, ask: "Fan three tasks out to platform sub-agents — count the words in three short texts — and give me the totals."
     The agent spawns with the tools, waits with `await_subagents`, does not start a background script, and reports only states it checked.
   - On Pi, ask for parallel work that needs no separate sandbox.
     The agent does not look for a subagent tool it does not have.

Print a short manual guide with these steps for the user when the slice is done.
