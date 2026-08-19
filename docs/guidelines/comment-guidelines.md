# Comment Guidelines

Rules for comments in TS/JS/Go source. Enforced twice: [`scripts/strip-comments.mjs`](../../scripts/strip-comments.mjs) deletes every comment that carries no registered type, and `mise run common:check:comment-types` fails when one slips in.

## The rule

Code carries no prose comments. What a comment would say, the code says instead — a better name, a narrower type, a smaller function. The one exception is a **typed comment**: prose prefixed with a type from the `COMMENT_TYPES` registry in [`scripts/strip-comments.mjs`](../../scripts/strip-comments.mjs).

## Typed comments

| Type | Where it goes | What it says |
|---|---|---|
| `TEST_OVERVIEW:` | Top of a spec file | The feature under test: what the module must do, in the same terms the specs assert |
| `TEST_SCENARIO:` | Above an `it()` | Why the scenario exists: the situation, and what must hold in it |
| `UNIT_BOUNDARY_DESCRIPTION:` | Above a file's single exported unit | What the unit does and why it exists as its own module |

A new kind of comment starts by registering its type in `COMMENT_TYPES` — an unregistered prefix is stripped like any other prose.

## How to write one

- **Plain English, short sentences.** Write for a reader with English as a second language. Simple words beat stylistic flourish, even when older files in the suite read literary.
- **Grounded in mechanics.** Name the real frames, fields, limits, and commands. Every claim should be checkable against the code or the wire.
- **Say why, in domain vocabulary.** The code below already says how. Use the terms from [`docs/ubiquitous-language.md`](../ubiquitous-language.md) — Session, Session Transcript, Prompt Scheduler — so the comment and the docs describe one system.

## Tool directives

`@ts-expect-error`, `eslint-disable`, `prettier-ignore`, `//go:build`, `// +kubebuilder:...` and similar are instructions to tools, not comments — the stripper keeps them. The pattern lists (`PRESERVE_TS`, `PRESERVE_GO`) live in [`scripts/strip-comments.mjs`](../../scripts/strip-comments.mjs); a new directive pattern is added there.
