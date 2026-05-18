# Review Mode

The user wants an architecture review of a TypeScript client-server project that follows (or aims to follow) the opinionated TypeScript Engineering (TSEng) architecture. Architecture docs live at `../architecture/` relative to this file.

## Scope

Ask if not obvious. One of:

- **Full repo / package / module / file** — review the code as it exists.
- **Diff** — uncommitted changes, branch diff, or staged changes via git.
- **PR** — fetch via `gh pr view` and `gh pr diff`. Number or URL.

For diff and PR scope, the baseline is the unchanged code. Only flag violations introduced or amplified by the change. Pre-existing violations the change does not touch are out of scope.

## Load Order (Lazy)

Start with [../architecture/index.md](../architecture/index.md). For full reviews, load every linked file. For diff or PR reviews, load the files that cover the layers and concerns the diff touches. Load additional files from `../architecture/` when a finding hints at a rule from a file not yet loaded.

## Output

Report only findings about alignment with the architecture docs, not general code review concerns. Do not raise concerns that are not backed by a rule in the docs.

For each finding: the rule, the location, one-line evidence, and the architecture file it came from.

End with the smallest set of changes that would clear the largest number of findings.
