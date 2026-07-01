---
name: pr-artifact
description: >
  Build a self-contained visual Artifact that walks a reviewer through a pull request — a
  guided narrative that explains every decision and every problem encountered, in plain
  English, with diagrams or charts where they clarify. Use when the user wants a "PR review
  artifact", a "code review walkthrough", "help me review PR X", "a summary artifact for a
  PR", or to "guide a reviewer through" a branch/PR. Asks which PR if not given.
argument-hint: "[PR number, branch, or URL]"
---

# PR Review Artifact

Produces one thing: a **self-contained Artifact** (hosted HTML page) that guides a reviewer
through a pull request. Not a diff dump — a narrative. It explains *what* changed, *why* each
decision was made, and *what problems came up and how they were solved*, ordered so the reader
builds understanding as they scroll. Diagrams and charts are welcome wherever they beat prose.

The goal is that someone who has never seen the branch can read the artifact top-to-bottom and
land in the diff already knowing what to look at and why.

## Workflow

1. **Identify the PR.** If the user named one (number, branch, or URL), use it. Otherwise check
   the current branch for an open PR (`gh pr view --json ...`). If there's still no clear
   target, **ask which PR** — don't guess. Accept a branch with no PR too (diff against the
   merge base).

2. **Gather everything.** Pull the full picture, not just the diff:
   - `gh pr view <ref> --json title,body,commits,files,additions,deletions,baseRefName,headRefName,url`
   - `gh pr diff <ref>` for the full patch; `gh pr view <ref> --comments` for review discussion.
   - Linked issues (from the body / commit trailers) — read them for the *original* problem.
   - The commit history is the story of how the change evolved. Read messages in order; false
     starts, reverts, and fix-up commits are where "problems encountered" hide.

3. **Read the actual code.** Open the changed files in the working tree, not just the patch
   hunks — you need the surrounding context to explain a decision honestly. For a large PR,
   fan out `Explore` agents to map the change surface, then read the load-bearing files
   yourself. Do not narrate code you have not read.

4. **Reconstruct the story.** Before writing anything, be able to answer:
   - **The problem** — what wasn't working / was missing before this PR.
   - **The shape** — the handful of moving parts and how they fit together now.
   - **Every decision** — what was chosen, what the alternatives were, why this one won. Ground
     each in real evidence (a commit, a comment, the code). Never invent a rationale.
   - **Every problem encountered** — bugs, dead ends, tricky edge cases, things that fought
     back — and how each was resolved. This is the most valuable and most-skipped section.
   - **Technical impact** — where the change couples to the rest of the system, what its blast
     radius is, what other subsystems now depend on it or are affected. Describe it; don't
     grade it. This is a high-level read, not a hunt for nits.

5. **Load `artifact-design`.** Invoke the `artifact-design` skill to calibrate how much design
   investment this warrants, then build. (The `Artifact` tool requires this.)

6. **Build the Artifact.** Write the page to a file (default to the scratchpad dir), then call
   `Artifact`. See the content contract below.

7. **Hand back the URL** in one line. The artifact is private by default; the user shares it if
   they want.

## Content contract

The artifact must, at minimum:

- **Guide the reader.** Structure it as a walkthrough with a clear reading order, not a flat
  list of files. Open with a TL;DR / the problem being solved, then tour the change in an order
  that builds understanding, then close with its technical impact (coupling, blast radius).
- **Explain every decision.** For each meaningful choice: what was decided, the alternatives,
  and why. Keep it honest — if a decision was a pragmatic compromise, say so.
- **Explain every problem encountered.** What went wrong or was hard, and how it was resolved.
  Pull these from commit history, review threads, and the code itself.
- **Use visuals when they help.** Before/after diagrams, data-flow or sequence diagrams,
  component maps, a bar showing where the churn landed. Only when they clarify — never as
  decoration. Everything must be inlined (the artifact CSP blocks all external requests).
- **Plain English, human voice.** Write like a colleague explaining their PR over coffee. Short
  sentences. No em dashes. No filler ("obviously", "simply", "just"). No LLM throat-clearing.

## Quality bar

- **Stay at altitude.** This is about consequences and coupling, not nitpicks. Explain what a
  decision touches and how pieces depend on each other. Do not critique naming, style, or
  micro-optimize an algorithm — that is not the job.
- **Describe, don't judge.** Present each decision and problem neutrally: what the situation was
  and how it was approached. Do not editorialize or speculate about hypothetical failures ("this
  may cause X", "this could break Y"). Let the reader draw the conclusion. If the PR itself
  flags an open risk, report it as the authors framed it, not as your own warning.
- **Right-sized.** Match effort to the PR. A three-line fix gets a short page; a subsystem
  rewrite earns diagrams and sections. Don't pad a small PR into a big artifact.
