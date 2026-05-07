# Issue 8 — XDG paths for `dam` config

**Depends on:** 3, 4
**Blocks:** [#80](https://github.com/dam-agents/dam/issues/80) (credentials adapter assumes the XDG split)

## Context

[ADR-039](../../adrs/039-cli-foundation.md) §"Decision" commits to the [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html): editable configuration under `$XDG_CONFIG_HOME/dam/` (default `~/.config/dam/`), and machine-managed state — including credentials when they land — under `$XDG_STATE_HOME/dam/` (default `~/.local/state/dam/`). The shipped CLI puts everything under `~/.dam/` instead. This is a gap between an accepted decision and the implementation, not a future change of mind.

**Why it matters:**

- Users running dotfile managers, containerized setups, or multi-user machines that rely on `XDG_CONFIG_HOME` / `XDG_STATE_HOME` overrides — those overrides are silently ignored today.
- The split the ADR is built around — editable user intent vs. machine-managed state — does not actually exist on disk. When credentials arrive ([#80](https://github.com/dam-agents/dam/issues/80)) they would land next to the editable config, the exact conflation the ADR rejects.
- The architecture page (`docs/architecture/cli.md`) and the CLI's own help text describe the old `~/.dam/` location, so what a reader learns from the docs no longer matches what the ADR has already decided.

**Why now:** the CLI hasn't shipped on npm yet — no installed users, no migration tax. Doing it before [#80](https://github.com/dam-agents/dam/issues/80) means the credentials adapter can target the right directory from the start.

**Out of scope** (separate threads):

- Credential storage shape and lifecycle — owned by [#80](https://github.com/dam-agents/dam/issues/80). This issue only commits to *where* credentials will live; it does not write the state-path helper or any state-side adapter.
- Native Windows path conventions. WSL2 is the supported path today; native Windows reopens with [#86](https://github.com/dam-agents/dam/issues/86).
- Migration from the old `~/.dam/` location. None needed — the CLI is unpublished. Source-tree dev users starting against the new path is acceptable.
- Updating the historical plan documents in `docs/plans/cli-foundation/` (`02-…`, `03-…`, `04-…`) that mention `~/.dam/`. Those are frozen work-tracking artifacts; PR-comment B in [#121](https://github.com/dam-agents/dam/pull/121) proposes removing the folder entirely. Touching them now is busywork.

## Scope

### Resolver — `infrastructure/config-path.ts`

Edit `packages/cli/src/modules/cli/infrastructure/config-path.ts`:

- Change the function signature to `defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string`. Accepting env as a parameter makes it unit-testable without monkey-patching globals. Default to `process.env` so existing callers (`compose.ts`) need no change.
- Implement XDG resolution:
  ```ts
  export function defaultConfigPath(
    env: NodeJS.ProcessEnv = process.env,
  ): string {
    const xdg = env.XDG_CONFIG_HOME;
    if (xdg && xdg.length > 0) return join(xdg, "dam", "config.toml");
    return join(homedir(), ".config", "dam", "config.toml");
  }
  ```
- The "empty string is unset" rule mirrors the XDG spec (§"Basics") and the existing `EnvReader` convention from issue 3.

**No new state-path helper.** Add it in [#80](https://github.com/dam-agents/dam/issues/80) when there's a caller. Establishing dead infrastructure now is YAGNI; the path is committed in the docs.

### Composition — `compose.ts`

Edit `packages/cli/src/modules/cli/compose.ts`:

- Update the `ComposeOptions.configPath` JSDoc (currently references `${HOME}/.dam/config.toml`):
  ```ts
  /** Override for the production config path (resolved via XDG —
   *  `$XDG_CONFIG_HOME/dam/config.toml`, default `~/.config/dam/config.toml`).
   *  Used by integration tests; defaults to the real path otherwise. */
  configPath?: string;
  ```
- The `defaultConfigPath()` call site is unchanged — the API is the same opaque-string return.

### Help text — `commands/config-set.ts`

Edit `packages/cli/src/modules/cli/commands/config-set.ts:20`:

- Replace the literal `"Set a single config key in ~/.dam/config.toml"` with a description that doesn't pin a path: `"Set a single config key in the CLI config file"`. The success line at `config-set.ts:39` already prints the resolved `deps.configPath`, so users still see the actual location after a write.

### Architecture page — `docs/architecture/cli.md`

Edit the page to drop the four `~/.dam/` references:

- **Line 7** ("Motivated by"): replace `flat config under \`~/.dam/\`` with `flat config under XDG-standard locations`.
- **Line 18** ("Trust boundary"): replace `reads and writes only under \`~/.dam/\` (today: \`config.toml\`; later, credentials in their own files)` with `reads and writes only under the XDG config and state directories (today: \`config.toml\` under \`$XDG_CONFIG_HOME/dam/\`; later, credentials under \`$XDG_STATE_HOME/dam/\`)`.
- **Line 22** ("Config" intro): replace `Two persistence concerns share \`~/.dam/\`: the configuration the user can edit (this file) and credentials, which arrive with [#80] and live in their own files.` with `Two persistence concerns are split across the XDG directories: editable configuration (this file, under \`$XDG_CONFIG_HOME/dam/\`) and credentials, which arrive with [#80] and live under \`$XDG_STATE_HOME/dam/\`.`
- **Line 24** ("Location" bullet): replace `\`~/.dam/config.toml\`. Flat schema, no profile indirection.` with `\`$XDG_CONFIG_HOME/dam/config.toml\` (default \`~/.config/dam/config.toml\`). Flat schema, no profile indirection.`

The "Last verified" date at line 3 should bump to the merge date of this work.

### `docs/architecture.md` index entry

Already addressed by [issue 7](07-review-followup.md) §"R7 + R8 — `docs/architecture.md` line 60" — that change strips the `~/.dam/` mention from the index entry. If the two PRs land in either order this section is a no-op; if they conflict, the rewrite from issue 7 wins (it drops the path mention entirely).

## Tests

### New unit tests — `packages/cli/src/__tests__/config-path.test.ts`

Create a new test file. The function is now pure-with-env-injection, so all four cases are trivial:

```ts
describe("defaultConfigPath", () => {
  it("uses XDG_CONFIG_HOME when set", () => {
    expect(defaultConfigPath({ XDG_CONFIG_HOME: "/tmp/xdg" }))
      .toBe("/tmp/xdg/dam/config.toml");
  });

  it("falls through when XDG_CONFIG_HOME is empty", () => {
    expect(defaultConfigPath({ XDG_CONFIG_HOME: "" }))
      .toMatch(/\.config\/dam\/config\.toml$/);
  });

  it("falls through when XDG_CONFIG_HOME is unset", () => {
    expect(defaultConfigPath({}))
      .toMatch(/\.config\/dam\/config\.toml$/);
  });

  it("default fallback uses $HOME/.config/dam/config.toml", () => {
    expect(defaultConfigPath({ HOME: "/Users/test" }))
      // os.homedir() ignores process.env.HOME on some platforms, so assert
      // the structural shape rather than the absolute path.
      .toMatch(/\.config\/dam\/config\.toml$/);
  });
});
```

### Updated integration tests

- `packages/cli/src/__tests__/config-set.integration.test.ts:48` — change `configPath = join(home, ".dam", "config.toml")` to `configPath = join(home, ".config", "dam", "config.toml")`. The spawned child only inherits the env we pass (`HOME`, `PATH`), so `XDG_CONFIG_HOME` is naturally unset in the child and the resolver falls through to `$HOME/.config/dam/`. No env additions needed.
- `packages/cli/src/__tests__/ping.integration.test.ts` and `version.integration.test.ts` — these test files reach the config file only via `dam config set`, never by direct path comparison. Verify by re-reading: no `.dam` literals, no `configPath` math. **No edits expected; verify and confirm.**

### Belt-and-braces XDG case

Add one integration assertion in `config-set.integration.test.ts` (a new `it` block):

```ts
it("honors XDG_CONFIG_HOME when set", async () => {
  const xdg = await mkdtemp(join(tmpdir(), "dam-xdg-"));
  const r = await runDam(
    ["config", "set", "server", "https://example.test"],
    { HOME: home, XDG_CONFIG_HOME: xdg, PATH: process.env.PATH ?? "" },
  );
  expect(r.exitCode).toBe(0);
  const expected = join(xdg, "dam", "config.toml");
  expect(r.stdout).toContain(expected);
  await readFile(expected, "utf-8"); // throws if absent
  // And the HOME-derived path must NOT exist:
  await expect(readFile(join(home, ".config", "dam", "config.toml")))
    .rejects.toThrow();
  await rm(xdg, { recursive: true, force: true });
});
```

This is the one case the unit tests can't fully cover — it verifies the env actually flows from `process.env` into the resolver in the production wiring path, not just the test wiring.

## Acceptance criteria

- `mise run check` passes.
- `mise run cli:test` passes (with the four new unit tests + one new integration test = 78 tests, up from 73; subject to base count after issue 7 lands).
- `mise run helm:check:render` + `mise run helm:check:lint` — pass (helm chart is not touched, but the gate is cheap).
- A fresh CLI run with no env overrides creates `~/.config/dam/config.toml`. The old `~/.dam/` directory is **not** created.
- A CLI run with `XDG_CONFIG_HOME=/tmp/x dam config set server https://example.test` creates `/tmp/x/dam/config.toml` and not `~/.config/dam/config.toml`.
- `dam config set` success message prints the resolved path under `~/.config/dam/` (or the `XDG_CONFIG_HOME` override).
- `docs/architecture/cli.md` no longer contains the literal `~/.dam/`.
- `docs/architecture/cli.md`'s "Last verified" date is bumped.

### Reviewer checklist

- The function takes env as a parameter — not a hard `process.env` reach. (Tests should not need to monkey-patch globals.)
- "Empty string is unset" is implemented for both `XDG_CONFIG_HOME` (this issue) — matches the EnvReader convention from issue 3.
- The state path is **not** added prematurely. No `defaultStatePath()`, no `$XDG_STATE_HOME` reading, no second adapter wiring. That belongs in [#80](https://github.com/dam-agents/dam/issues/80).
- Architecture-page edits keep the page under its stable-content threshold — XDG terminology is framework-level, not mechanism. (Compare with the `~/.dam/` literal that just got dropped from the index.)
- Tests assert structural path shape (`/.config/dam/config.toml$/`), not absolute paths — `os.homedir()` resolution can vary by platform.

## Out of scope (explicit)

- The state-path helper and `$XDG_STATE_HOME` resolver — owned by [#80](https://github.com/dam-agents/dam/issues/80).
- Migration of any pre-existing `~/.dam/config.toml` from a from-source dev install — manual one-time `mv` is fine; documenting it isn't worth release-note real estate.
- Updating the historical `docs/plans/cli-foundation/02-…`, `03-…`, `04-…` files that mention `~/.dam/`. PR-comment B's audit decides their fate.
- Native Windows path conventions (`%APPDATA%`, etc.) — WSL2 only today.
- Any change to the `EnvReader` API. The XDG read happens in `infrastructure/config-path.ts`, not through the `EnvReader` port — `defaultConfigPath` runs at compose time, before services exist.

## Verification

```sh
mise run check
mise run cli:test
mise run cli:build

# 1) Default — falls through to $HOME/.config/dam/
TMPHOME=$(mktemp -d)
HOME=$TMPHOME node packages/cli/dist/bin.js config set server https://example.test
test -f "$TMPHOME/.config/dam/config.toml" && echo "ok: default path"
test ! -d "$TMPHOME/.dam" && echo "ok: no legacy dir"

# 2) XDG_CONFIG_HOME override wins
TMPXDG=$(mktemp -d)
HOME=$TMPHOME XDG_CONFIG_HOME=$TMPXDG node packages/cli/dist/bin.js \
  config set server https://example.test
test -f "$TMPXDG/dam/config.toml" && echo "ok: xdg override"
# The HOME-derived path from step 1 still exists from the previous run; the
# point here is that the override path now also exists.

# 3) Empty XDG_CONFIG_HOME falls through (matches the spec)
TMPHOME2=$(mktemp -d)
HOME=$TMPHOME2 XDG_CONFIG_HOME="" node packages/cli/dist/bin.js \
  config set server https://example.test
test -f "$TMPHOME2/.config/dam/config.toml" && echo "ok: empty xdg = unset"

# 4) Doc grep — no surviving `~/.dam/` in the architecture page
! grep -q '~/\.dam/' docs/architecture/cli.md && echo "ok: docs clean"

# 5) Cleanup
rm -rf "$TMPHOME" "$TMPHOME2" "$TMPXDG"
```

## Reference files

- [ADR-039](../../adrs/039-cli-foundation.md) §"Decision" — the XDG commitment.
- [PR #100](https://github.com/dam-agents/dam/pull/100) — where the ADR flipped from `~/.<vendor>/` to XDG.
- Issue [03-config-domain-and-adapters.md](03-config-domain-and-adapters.md) — the resolver this issue rewrites (historical plan; ignore the literal `~/.dam/` references — they are pre-flip).
- Issue [04-config-service-and-set-command.md](04-config-service-and-set-command.md) — same caveat on `~/.dam/` references.
- [docs/guidelines/documentation-guidelines.md](../guidelines/documentation-guidelines.md) — informs the architecture-page edits (framework-level terminology over mechanism).
