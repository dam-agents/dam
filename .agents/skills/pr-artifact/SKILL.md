---
name: pr-artifact
description: >
  Build a self-contained visual Artifact that walks a reviewer through a pull request — a
  guided narrative that explains every decision and every problem encountered, in plain
  English.
argument-hint: "[PR number or branch]"
---

# PR Review Artifact

Produce one **self-contained Artifact** (hosted HTML page) that guides a reviewer through a pull request as a narrative, not a diff dump: _what_ changed, _why_ each decision was made, _what problems came up and how they were solved_, ordered so understanding builds as they scroll. Someone who never saw the branch should land in the diff already knowing what to look at and why. The reader is usually technical and knows the application, so tie explanations to how it works, not to abstract principles.

## Context assembly

1. **Identify the PR.** If prior context doesn't name one, ask for a PR number or branch.
2. **Gather everything**: diff, linked issues, comments, commit history.
3. **Read the changed files in the working tree**, not just the hunks; explaining a decision honestly needs the surrounding code.
4. **Reconstruct the story** before writing:
   - **The problem**: what was broken or missing before.
   - **The shape**: the few moving parts and how they fit now.
   - **Every decision**: the choice, the alternatives, why it won, grounded in evidence (commit, comment, code). Never invent a rationale.
   - **Every problem encountered**: bugs, dead ends, edge cases, things that fought back, and how each was resolved. The most valuable and most-skipped part.
   - **Technical impact**: coupling, blast radius, which subsystems now depend on it or are affected. Describe, don't grade; high-level, not a nit hunt.

## Artifact construction

1. **Load `artifact-design`** (the `Artifact` tool requires it) to calibrate design investment.
2. **Write the page** to a file (default: scratchpad) and call `Artifact`, following the content contract.
3. **Hand back the URL** in one line. It's private by default; the user shares it if they want.

## Content contract

- **Guide the reader**: a walkthrough with a clear reading order, not a list of files. Open with a TL;DR / the problem, tour the change in an order that builds understanding, close with technical impact (coupling, blast radius).
- **Explain every decision**: what, the alternatives, why. Call a pragmatic compromise one.
- **Explain every problem encountered** and its resolution, from commit history, review threads and the code.
- **Visuals only where they clarify** (before/after, data-flow or sequence diagrams, component maps, where the churn landed), never as decoration.
- **Plain English, human voice**: a colleague explaining their PR over coffee, in short, direct sentences that lead with the point.
- **Explain from the application's perspective**: what a user, request or job does differently now, and which part of the running system that touches. Name the flows and subsystems the reader knows; never narrate the diff file by file.

## Quality bar

- **Stay at altitude**: consequences and coupling, not naming, style or micro-optimizations.
- **Describe, don't judge**: present each decision and problem neutrally; no editorializing or speculative failures ("this may cause X"). Report a risk the PR itself flags as the authors framed it, not as your warning.
- **Right-sized**: a three-line fix gets a short page; a subsystem rewrite earns diagrams and sections. Don't pad.
