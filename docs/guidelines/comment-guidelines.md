# Code Comment Guidelines

Rules for comments in TS/JS/Go source code. Prescriptive: `mise run common:check:comment-types` enforces them.

## The rule

Code carries no untyped prose comments. Every comment must start with a registered type prefix in the form `TYPE:`, where `TYPE` is one of the registered comment types below. Everything else was removed on purpose — the code, the tests, and the architecture docs carry the information instead.

```ts
/**
 * TEST_OVERVIEW: connecting to a sandbox.
 *
 * Written from the client's side of the socket. A scenario says what someone
 * did and what they should observe; implementation detail is never named in
 * an assertion.
 */
```

## Registered comment types

| Type | Where | What it carries |
| --- | --- | --- |
| `TEST_OVERVIEW` | Top of a spec file (one per file) | The feature under test, written from the user's point of view — what the scenarios cover and the perspective they assert from. |

Adding a type is a deliberate act: extend `COMMENT_TYPES` in [`scripts/strip-comments.mjs`](../../scripts/strip-comments.mjs) and add a row here, in the same PR that introduces the first comment of that type.

## Exemptions

- **Tool directives** are instructions to machines, not prose, and are always allowed: `@ts-expect-error`, `eslint-disable`, `prettier-ignore`, `/// <reference>`, `//go:` directives, `// +kubebuilder` markers, `//nolint`, license headers.
- **Generated files** (`*.gen.ts`, `zz_generated*`, anything marked `DO NOT EDIT`) are never checked.
- [`scripts/strip-comments.mjs`](../../scripts/strip-comments.mjs) itself keeps its untyped usage docs — it is the tool that defines the registry and it documents both scripts.

## Tooling

- `node scripts/strip-comments.mjs [--write]` — removes every comment that is neither a directive nor a registered typed comment. This is how the repo got comment-free; rerunning it is always safe for typed comments.
- `node scripts/check-comment-types.mjs` — fails with `file:line` for every untyped comment. Runs as part of `mise run check`.

Scope of both: `ts/tsx/js/jsx/mjs/cjs/go`. Comments in shell, YAML, SQL, Python, and TOML are out of scope for now.
