---
name: fix-security
description: >
  Fetch open GitHub issues labeled "security" and open Dependabot alerts,
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

# Fix Security Issues

Scan for open security issues and Dependabot alerts, fix each one, and open PRs after user approval.

## Phase 1 — Gather

Collect all open security work items from two sources in parallel:

### GitHub issues

```sh
gh issue list --label security --state open --json number,title,body,labels,url --limit 50
```

### Dependabot alerts

```sh
gh api repos/{owner}/{repo}/dependabot/alerts --method GET \
  -q '[.[] | select(.state=="open")] | sort_by(.security_advisory.severity | if . == "critical" then 0 elif . == "high" then 1 elif . == "medium" then 2 else 3 end)'
```

Infer `{owner}/{repo}` from the git remote.

If both sources return zero items, tell the user there is nothing to fix and stop.

## Phase 2 — Triage and present

Present a numbered summary table to the user:

| # | Source | Severity | Title | Detail |
|---|--------|----------|-------|--------|

- For Dependabot alerts: severity from the advisory, package name, current → patched version.
- For issues: use labels or body content to infer severity; default to "medium" if unclear.

Sort by severity (critical > high > medium > low).

Ask the user which items to fix. Default suggestion: all of them.

## Phase 3 — Fix (one branch per item)

For each approved item, working sequentially:

1. **Create a branch** from `main` named `fix/security-<short-slug>` (e.g., `fix/security-cve-2026-45740`).

2. **Dependabot alerts** — identify the dependency and fix:
   - Read the lockfile and package manifest to understand the current version.
   - Update the dependency to the patched version recommended by the advisory.
   - Run `pnpm install` (via `mise run` if a task exists, otherwise `pnpm install`) to regenerate the lockfile.
   - Run `mise run check` to verify nothing breaks.

3. **Security issues** — read the issue body carefully, investigate the codebase to understand the vulnerability, implement the fix. Run `mise run check` and `mise run test` to verify.

4. **Present the diff** to the user:
   - Show `git diff` of all changes.
   - Summarize what was changed and why.
   - Ask for explicit approval to commit and open a PR.

5. **On approval** — commit (using `git commit -s` with conventional commit format `fix(security): <summary>`) and push, then open a PR:

   ```sh
   gh pr create --title "fix(security): <short title>" --body "$(cat <<'EOF'
   ## Summary

   <what and why>

   Closes #<issue-number>  ← if from a GitHub issue
   Fixes <CVE-ID>          ← if from a Dependabot alert

   ## Test plan

   - [ ] `mise run check` passes
   - [ ] `mise run test` passes
   EOF
   )"
   ```

6. **On rejection** — ask what to change, revise, and re-present the diff. Do not commit without approval.

7. **Clean up** — switch back to `main` before starting the next item.

## Phase 4 — Summary

After all items are processed, print a summary table:

| # | Title | Status | PR |
|---|-------|--------|----|

Status is one of: PR opened, skipped, user declined.

## Rules

- Never commit or push without explicit user approval for that specific item.
- Each fix gets its own branch and PR — do not bundle unrelated fixes.
- Always run `mise run check` before presenting a diff. If it fails, fix the issue first.
- Follow the project's commit conventions (conventional commits, signed-off, no manual attribution trailer).
- If a fix is non-trivial or risky, explain the trade-offs before asking for approval.
