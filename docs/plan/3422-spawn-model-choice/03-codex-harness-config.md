# 03 — Codex honors a harness config

**Depends on:** 01-spawn-sets-harness-config
**Part of:** A spawn chooses the model its sub-agent runs — see [README](./README.md)

## Context

Codex is the only catalogue harness whose image declares no `harness-config` driver. So a
spawn cannot choose its model (after slice 02 such a spawn fails fast), and Codex agents have
no model picker in the Config panel. This slice gives the Codex image a driver. A second
problem blocks it: the harness scripts turn the connection's `OPENAI_MODEL` into
`-c model="…"`, and a `-c` flag outranks the config file. The ibm-litellm connection always
sets `OPENAI_MODEL`. So the slice also makes a model in the file outrank that env pin. Bob
(`packages/agents/bob/bob-settings.mjs`) and Pi (its `pi-dynamic-providers` extension) already
follow that rule. The change stays inside `packages/agents/codex/` plus docs. The Config panel
section appears on its own, because the UI gates it on the `harnessConfig` capability.

## Implementation plan

1. **Manifest.** Add `packages/agents/codex/runtime-manifest.yaml` (`manifestVersion: 1`). Model
   it on `packages/agents/pi-agent/runtime-manifest.yaml` and the binding schema in
   `packages/agent-runtime/src/modules/runtime-channel/manifest.ts`. It declares a
   `harness-config` driver:
   - `file: "$HOME/.codex/config.toml"`, `format: toml` (the file codec already reads and writes TOML).
   - `keys`: `model: "model"`, and `configOptions.effort: "model_reasoning_effort"`. Declare
     no `mode` key: `/etc/codex/config.toml` pins the approval policy and the sandbox for the
     pod, and they must stay pinned.
   - `catalog.options`: `model` (`category: model`, `choices: []`, filled by discovery), and
     `effort` (`category: thought_level`). Take the choices from the `model_reasoning_effort`
     values the Codex version pinned in `harness-tools.toml` accepts. Do not copy another
     harness's list.
   - `modelDiscovery`: `urlEnv: [OPENAI_BASE_URL]`, the default `openai-models` shape,
     `pinEnv: [OPENAI_MODEL]`, and **no** `redirectEnv`. Both catalogue connections either pin
     `OPENAI_MODEL` (ibm-litellm) or point at OpenAI itself, where Codex's own default is the
     better answer. So no model is seeded. See [harness-config](../../architecture/harness-config.md#model-discovery-and-the-seeded-model).
   - Add a short header comment, as the other manifests have. It says what the file maps and
     why no seed.
2. **Precedence.** In `harness-chat.sh` and `harness-terminal.sh`, add
   `-c model="$OPENAI_MODEL"` only when `$HOME/.codex/config.toml` sets no top-level `model`.
   - "Top-level" means a `model =` line before the first `[table]` header, because a
     `[profiles.x]` table can carry its own `model`.
   - Keep the scripts POSIX `sh`. If the check reads cleaner as one small shared helper that
     both scripts call, factor it out; otherwise keep one guarded line in each.
   - Leave `model_provider` and `base_url` handling unchanged.
3. **Dockerfile.** Ship the manifest as the other harness images do:
   `COPY --chown=65532:0 runtime-manifest.yaml /app/runtime-manifest.yaml`.
4. **Verify the layering in the pod before you rely on it.** Codex must read
   `$HOME/.codex/config.toml` as the user layer, above `/etc/codex/config.toml`. `codex-acp`
   must read the same file. Check that a model and an effort written there take effect in a
   chat session and in a terminal session. If the layering differs, adjust the manifest's
   `file` or the scripts, and record the finding in the Codex README.
5. **Codex README** (`packages/agents/codex/README.md`): document how the model is chosen (a
   Config panel pick or a spawn's choice in the file; otherwise the connection's
   `OPENAI_MODEL`; otherwise Codex's default). Its "Custom OpenAI-compatible endpoints" note
   names a `-c openai_base_url` override that the scripts no longer use. Correct it while you
   are in the file.
6. **Skills.** Add the Codex row to dam-invoke's value table
   (`packages/agents/claude-code/workspace/.agents/skills/dam-invoke/SKILL.md`): model from
   the provider's list, `configOptions.effort`, no `mode`.
7. **Architecture docs.** In `docs/architecture/harness-config.md`, state once, at the level
   of meaning, the rule every harness with a pin now follows: a connection's model pin is a
   default, and a model value in the harness's file that the provider offers outranks it.
   Bump `Last verified:`. Do not list harness names on the page.

## Acceptance criteria

- [ ] A Codex agent advertises the `harnessConfig` capability on `hello`, and its Config panel
      shows a model list and an effort choice.
- [ ] A model picked in the panel lands as top-level `model` in `~/.codex/config.toml`. The
      next Codex session uses it, even when the connection sets `OPENAI_MODEL`.
- [ ] With no `model` in the file, Codex still runs on the connection's `OPENAI_MODEL`, as on
      `main`.
- [ ] A spawn with `template: "codex", model: …` succeeds and runs on that model. Slice 02's
      fail-fast does not fire.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

1. Run `mise run check` and `mise run test`.
2. Run `mise run cluster:build-agent` (it rebuilds the Codex image and restarts its pods).
3. Create a Codex agent with an ibm-litellm connection. Open its Config panel. Expect a model
   list from the provider and an effort choice. Pick a model other than the connection's
   `OPENAI_MODEL` (the ibm-litellm placeholder is `gpt-5.5`).
4. In the agent's pod, run `cat ~/.codex/config.toml` and expect the top-level `model` you
   picked. Start a chat session, ask which model it runs, and expect the picked one. Repeat in
   a terminal session (`/status` in the Codex TUI shows the model).
5. Clear the pick (or delete the `model` line) and start a new session. Expect the connection's
   `OPENAI_MODEL` again.
6. Rerun slice 02's smoke step 3 (a Codex spawn with `model`). Expect it to succeed now, and
   the child to report the requested model.
