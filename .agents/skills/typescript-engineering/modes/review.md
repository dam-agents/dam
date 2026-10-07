# Review Mode

## Scope

Full repo / package / module / file (the code as it is); a diff (uncommitted, staged or branch, via git); or a PR (`gh pr view`, `gh pr diff`; number or URL). For diffs and PRs, flag only violations the change introduces or amplifies; untouched pre-existing ones are out of scope.

Read [../architecture/index.md](../architecture/index.md). Full review: load every linked file. Diff/PR: load the files covering the layers and concerns touched, plus any file a finding points to.

## Output

Only findings about alignment with the architecture docs, each backed by a rule in them; no general code review. Per finding: the rule, location, one-line evidence, source file. End with the smallest set of changes clearing the most findings.
