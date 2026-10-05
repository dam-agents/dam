# 05 — pi steers

**Depends on:** 03-native-steer
**Part of:** Mid-turn steering and message correction — see [README](./README.md)

## Context

pi itself steers (RPC `steer`: delivered after the current tool calls, before the next model
call), but the ACP bridge we ship, `pi-acp` 0.0.33 (community package, svkozak/pi-acp, one
maintainer), queues mid-turn prompts itself and does not advertise `_session/steering`. Upstream
issue svkozak/pi-acp#7 asks for it; open PR svkozak/pi-acp#115 implements exactly the extension the
runtime detects (same method, same `_meta.steering.supported`). Carry that change in the pi-agent
image until a release has it. With it, pi steers in the web UI (03) and in Slack/Telegram with no
platform change.

## Implementation plan

1. **Ask the user first** how to carry the change, then implement:
   - **Preferred:** install pi-acp from the PR's head commit, pinned by sha and checksum, built in a
     `postinstall`, as `packages/agents/k-search/image.toml` does for source trees
     (`http:` tool + `postinstall` + `oci_link`); point `harness-chat` at the built entry.
   - **Fallback:** keep `npm:pi-acp` pinned and apply a patch file to the bundled `dist/index.js`
     in a `postinstall` (fragile: the bundle has no stable seams).
2. Review PR #115 against `@earendil-works/pi-coding-agent` 0.99.2 (our pin): the RPC `steer`
   command and its `images` argument, `idleBehavior: "promptRequired"` handling, and the
   `promptRequired` / `injected` outcomes the runtime expects.
3. `packages/agents/pi-agent/README.md`: one line that pi-acp carries the steering change and
   which upstream PR retires it.
4. Any comment or review on the upstream PR is posted only with the user's approval.

## Acceptance criteria

- [ ] A pi agent's `initialize` result has `_meta.steering.supported: true`.
- [ ] On a pi agent, a mid-turn web UI message is answered within the running turn (03's smoke
      test passes on pi).
- [ ] A Slack DM to a pi agent steers a mid-turn follow-up (channel-turns behavior, no code change).
- [ ] `mise run cluster:build -- agents` builds the pi-agent image.

## Smoke test

`mise run cluster:build -- agents`. On a pi agent run 03's smoke test. Then in a Slack DM bound to
the pi agent: send a slow task, a follow-up mid-turn; one reply covers both.
