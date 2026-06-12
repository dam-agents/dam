---
name: align-repo
description: |
  Check and align a repo's .claude/settings.json and CLAUDE.md with team conventions. Use when the user wants to standardize a repo, align conventions, check settings, or bootstrap Claude Code config in a new project.
---

# Align Repo Conventions

Audit the current repo's `.claude/settings.json` and `CLAUDE.md` against team standards.

## Execution Rules

- **Execute the checklist strictly step by step.**
- Present ONE item per message. Show its status, and if action is needed, ask and **STOP**.
- Do not present the next item until the user has responded.
- If an item is already aligned, say so and immediately proceed to the next item in the same message.
- If an item needs action, show current vs expected and ask: _"Want me to align this?"_
- Never batch multiple action items into one message.
- Never auto-apply changes — every modification requires explicit user confirmation.
- **Merge, don't overwrite** — add missing keys without clobbering existing ones.
- **Preserve existing content** in CLAUDE.md — don't remove or reorder existing sections.

## Checklist

- [ ] **0. Self-update** — Run: `npx skills add https://github.com/apocohq/skills --skill align-repo -a claude-code -y`. If updated, tell the user: _"align-repo was updated. Please start a new session and re-run `/align-repo` to use the latest version."_ **Stop — do not continue with outdated instructions.**
- [ ] **1. Gather state** — Read `.claude/settings.json`, `CLAUDE.md`, and check for `.claude/settings.local.json` (note existence, don't modify). If `.claude/settings.json` doesn't exist, ask if you should create it. If `CLAUDE.md` doesn't exist, ask if you should create it.
- [ ] **2. Attribution config** — Check `.claude/settings.json` for the expected `attribution` block (see Reference A).
- [ ] **3. Allowed tools** — Check `allowedTools` as a set (see Reference B). Report missing entries and flag extra entries (don't remove extras — they may be project-specific).
- [ ] **4. Worktrees convention** — Check `.gitignore` includes `.worktrees/`. Check `CLAUDE.md` for a Worktrees section (see Reference C).
- [ ] **5. Architecture principles** — Check `CLAUDE.md` for a Separation of Concerns & DRY section (see Reference D).
- [ ] **6. Commit conventions** — Check `CLAUDE.md` for a Commit Conventions section covering all 5 items (see Reference E).
- [ ] **7. Meeting format** — **Skip if no `meetings/` directory.** Check `CLAUDE.md` for a Meeting Format section (see Reference F).
- [ ] **8. Recommend skills** — Review repo purpose/tech stack. For each relevant skill from Reference G, explain why it fits and ask to install. Skip skills that don't match.
- [ ] **9. Check skill updates** — Run `npx skills check`. If updates available, ask to run `npx skills update`. Skip if no `skills-lock.json`.
- [ ] **10. Summary** — Print the alignment summary (see Reference H).

## References

### A. Expected attribution

```json
{
  "attribution": {
    "commit": "Assisted-By: Claude (Anthropic AI) <noreply@anthropic.com>",
    "pr": ""
  }
}
```

### B. Expected allowed tools

```json
{
  "allowedTools": [
    "Bash(git status*)",
    "Bash(git diff*)",
    "Bash(git log*)",
    "Bash(git fetch*)",
    "Bash(git branch*)",
    "Bash(git checkout -b *)",
    "Bash(git stash*)",
    "Bash(git add *)",
    "Bash(git commit *)",
    "Bash(gh issue view*)",
    "Bash(gh issue list*)",
    "Bash(gh pr view*)",
    "Bash(gh pr list*)",
    "Bash(ls:*)"
  ]
}
```

### C. Expected worktrees convention

```markdown
## Worktrees

Use `.worktrees/` for git worktrees. Branch naming follows commit conventions (e.g., `feat/session-history`).

### Setup

After creating a worktree, run project setup:

- **Node.js**: `pnpm install`
- **Python**: `uv sync`

### Verification

Run tests to confirm a clean baseline before starting work. If tests fail, report failures and ask before proceeding.

### Report

After setup, report: worktree path, test results, and readiness.
```

### D. Expected architecture principles

```markdown
## Separation of Concerns & DRY Principle

This system is a modular component system following the DRY (Don't Repeat Yourself) principle. Each piece has a single responsibility. You should be able to swap out any component without rewriting others.
```

### E. Expected commit conventions

```markdown
## Commit Conventions

- **Conventional Commits**: `type(scope): short summary` — types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `revert`, `style`, `perf`, `ci`, `build`.
- **Scope**: Optional but encouraged (e.g., `feat(ui):`, `fix(hook):`, `docs(design):`).
- **Body**: Optional concise bullet points for non-trivial changes.
- **Trailer**: Configured via `.claude/settings.json` `attribution` — do not add manually.
- **Branch naming**: `type/short-description` (e.g., `feat/session-history`, `fix/stale-timer`). Same type prefixes as commits.
```

### F. Expected meeting format

```markdown
## Meeting Format

---
date: "YYYY-MM-DD"
attendees:
  - First Last
  - First Last
---

# Meeting Title

One concise paragraph summarizing the meeting.

## Transcript / Notes / Meeting Minutes
```

### G. Available skills

| Skill | What it does | When to suggest |
|---|---|---|
| `process-transcript` | Converts VTT meeting transcripts into structured markdown notes | Repos that track meetings or have a `meetings/` directory |
| `ralph-it` | Picks the next user story from a PRD GitHub issue, implements it, and opens a PR | Repos that use GitHub issues for PRDs or have structured user stories |
| `write-a-prd` | Interviews the user and writes a PRD, then submits it as a GitHub issue | Any repo that plans features via PRDs or GitHub issues |
| `review-work` | Dispatches a code-reviewer subagent to review changes before pushing | Any repo where code quality reviews before push are desired |
| `adr` | Creates and updates Architecture Decision Records in `docs/adrs/` | Repos that track architectural decisions or have a `docs/adrs/` directory |

Install command: `npx skills add https://github.com/apocohq/skills --skill <skill-name> -a claude-code -y`

### H. Summary template

```
## Alignment Summary
- settings.json attribution: [aligned / changed / skipped]
- settings.json allowed tools: [aligned / changed / skipped]
- .gitignore worktrees: [aligned / added / skipped]
- CLAUDE.md worktrees: [present / added / skipped]
- CLAUDE.md architecture principles: [present / added / skipped]
- CLAUDE.md commit conventions: [present / added / skipped]
- CLAUDE.md meeting format: [present / added / skipped / n/a]
- Skills installed: [list or "none"]
- Skills updated: [list or "all up to date"]
- Items skipped by user: [list if any]
```
