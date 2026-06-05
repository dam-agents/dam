---
name: update-vulnerable-deps
description: >
  Fetch open GitHub issues labeled "vulnerability" and open Dependabot alerts,
  prepare fixes for each, then present to the user for approval before
  committing and opening PRs.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Agent
  - AskUserQuestion
---

Run in parallel:

```sh
gh issue list --label vulnerability --state open --json number,title,body,labels,url --limit 50
```

```sh
gh api repos/$(gh repo view --json nameWithOwner --jq .nameWithOwner)/dependabot/alerts --method GET \
  -q '[.[] | select(.state=="open")] | sort_by(.security_advisory.severity | if . == "critical" then 0 elif . == "high" then 1 elif . == "medium" then 2 else 3 end)'
```

If both sources return zero items, there is nothing to do, so stop.

Present a numbered summary table to the user, sorted by severity:

| # | Source | Severity | Title | Detail |
|---|--------|----------|-------|--------|

Ask the user which items to fix. Default suggestion: all of them.

Note: tools are configured to avoid releases younger than 7 days. Add an exclusion if necessary to install a fixed release. Review exclusions and remove ones that according to `git blame` were added more than 7 days ago.

By ecosystem:
- Mise: `mise use tool@version`, use `mise lock` to update `mise.lock`
- Node.js: use `pnpm`, with overrides in top-level `package.json` if necessary
- GitHub Actions: use `pinact`
- Go: fix manually, run `mise controller:scan:govulncheck` to verify
