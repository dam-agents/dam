---
name: pr-artifact
description: >
  Build a self-contained visual Artifact that walks a reviewer through a pull request — a
  guided narrative that explains every decision and every problem encountered, in plain
  English.
argument-hint: "[PR number or branch]"
---

# PR Review Artifact

Produces one thing: a **self-contained Artifact** (hosted HTML page) that guides a reviewer through a pull request. Not a diff dump — a narrative. It explains _what_ changed, _why_ each decision was made, and _what problems came up and how they were solved_, ordered so the reader builds understanding as they scroll. Diagrams and charts are welcome wherever they beat prose.

The goal is that someone who has never seen the branch can read the artifact top-to-bottom and land in the diff already knowing what to look at and why. Explanations tie to how the application works, not to abstract principles. The reader is usually technical and knows the application; the artifact helps them mentally map the change onto the system.

## Context Assembly

1. **Identify the PR.** When not specified in prior context ask the user for a PR number or branch name.

2. **Gather everything.** Pull the full picture, not just the diff. Include linked issues, comments, commit history.

3. **Read the actual code.** Open the changed files in the working tree, not just the patch hunks — you need the surrounding context to explain a decision honestly.

4. **Reconstruct the story.** Before writing anything, be able to answer:
   - **The problem** — what wasn't working / was missing before this PR.
   - **The shape** — the handful of moving parts and how they fit together now.
   - **Every decision** — what was chosen, what the alternatives were, why this one won. Ground each in real evidence (a commit, a comment, the code). Never invent a rationale.
   - **Every problem encountered** — bugs, dead ends, tricky edge cases, things that fought back — and how each was resolved. This is the most valuable and most-skipped section.
   - **Technical impact** — where the change couples to the rest of the system, what its blast radius is, what other subsystems now depend on it or are affected. Describe it; don't grade it. This is a high-level read, not a hunt for nits.

## Artifact Construction

1. **Load `artifact-design`.** Invoke the `artifact-design` skill to calibrate how much design investment this warrants, then build. (The `Artifact` tool requires this.)

2. **Build the Artifact.** Write the page to a file (default to the scratchpad dir), then call `Artifact`. See the content contract below.

3. **Hand back the URL** in one line. The artifact is private by default; the user shares it if they want.

## Content contract

The artifact must, at minimum:

- **Guide the reader.** Structure it as a walkthrough with a clear reading order, not a flat list of files. Open with a TL;DR / the problem being solved, then tour the change in an order that builds understanding, then close with its technical impact (coupling, blast radius).
- **Explain every decision.** For each meaningful choice: what was decided, the alternatives, and why. Keep it honest — if a decision was a pragmatic compromise, say so.
- **Explain every problem encountered.** What went wrong or was hard, and how it was resolved. Pull these from commit history, review threads, and the code itself.
- **Use visuals when they help.** Before/after diagrams, data-flow or sequence diagrams, component maps, a bar showing where the churn landed. Only when they clarify — never as decoration. Everything must be inlined (the artifact CSP blocks all external requests).
- **Plain English, human voice.** Write like a colleague explaining their PR over coffee. Short sentences. No em dashes. No filler ("obviously", "simply", "just"). No LLM throat-clearing.
- **Explain from application perspective.** Anchor every explanation in system behavior: what a user, request, or job does differently after this change, and which part of the running system that touches. Never narrate the diff file by file. The reader already knows the application, so name the flows and subsystems they know and show where the change lands in them.

## Quality bar

- **Stay at altitude.** This is about consequences and coupling, not nitpicks. Explain what a decision touches and how pieces depend on each other. Do not critique naming, style, or micro-optimize an algorithm — that is not the job.
- **Describe, don't judge.** Present each decision and problem neutrally: what the situation was and how it was approached. Do not editorialize or speculate about hypothetical failures ("this may cause X", "this could break Y"). Let the reader draw the conclusion. If the PR itself flags an open risk, report it as the authors framed it, not as your own warning.
- **Right-sized.** Match effort to the PR. A three-line fix gets a short page; a subsystem rewrite earns diagrams and sections. Don't pad a small PR into a big artifact.
