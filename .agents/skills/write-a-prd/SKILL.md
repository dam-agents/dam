---
name: write-a-prd
description: >
  Create a PRD through user interview, codebase exploration, and module design, then submit as a GitHub issue after user approval.
  Use when user wants to write a PRD, create a product requirements document, or plan a new feature. Always present the PRD for user approval before submitting.
---

Skip any step you don't need, except the user's approval before anything reaches GitHub.

1. Ask the user for a long, detailed description of the problem and any solution ideas.
2. Explore the repo to verify their assertions and learn the current state.
3. Interview the user relentlessly about every aspect of the plan until you share an understanding, walking each branch of the design tree and resolving dependencies between decisions one by one.
4. Sketch the major modules to build or modify, looking for deep modules (much functionality behind a simple, testable, rarely-changing interface) that can be tested in isolation. Confirm the modules match the user's expectations, and which ones they want tests for.
5. Write the PRD as a **feature** issue from the feature template in [docs/guidelines/issue-guidelines.md](../../../docs/guidelines/issue-guidelines.md): problem and goal from the user's perspective, user stories, and the implementation decisions under **Proposed solution** with their reasoning, kept durable rather than prescriptive. Present it in full and ask for approval.
6. Once approved, file it with the `file-issue` skill (dedupe, attribution, final approval, filing).
