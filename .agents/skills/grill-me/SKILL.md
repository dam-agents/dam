---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, challenging it against the project's architecture docs and ubiquitous language, sharpening terminology, and cross-referencing the code. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk each branch of the design tree, resolving dependencies between decisions one by one. Ask one question at a time, with your recommended answer, and wait for my reply before the next. If exploring the codebase can answer a question, explore instead of asking.

Read alongside the code:

- `docs/architecture.md` and the pages it links under `docs/architecture/`: the source of truth for *why* the system is shaped as it is.
- `docs/ubiquitous-language.md`: the glossary of domain terms.

## During the session

- **Glossary conflicts**: call out at once a term used against its glossary meaning. "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"
- **Fuzzy language**: propose a precise canonical term for a vague or overloaded one. "You're saying 'account' — do you mean the Customer or the User? Those are different things."
- **Concrete scenarios**: stress-test domain relationships with invented edge-case scenarios that force precise boundaries between concepts.
- **Code cross-reference**: when the user states how something works, check the code and surface contradictions. "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"
- **Update `docs/ubiquitous-language.md` as each term resolves**, not in a batch.
- **Decision log**: after each answer, append to a file outside the repo (the session scratchpad if any, else a temp file):

  ```
  <n>. <the question, one sentence>
     Recommended: <your recommended answer, one line>
     Decided: <"Accepted", or the user's answer in one line>
  ```

  Omit questions you answered from the code, and your reasoning. Build the wrap-up from this file, not memory: compaction loses early questions.

## Wrap up

When no branches remain open, or the user asks:

1. Show the decision log from the file, then an "Open questions" list of anything unresolved. No intro line.
2. Session about a GitHub issue → ask whether to post the log as a comment. Post with `gh issue comment` only after the user approves the exact text, then `gh issue edit --add-label agent/grilled`. Never edit the issue body; if it is now out of date, say so under "Open questions".
3. Otherwise offer to file an issue with the `file-issue` skill, passing the log as input, and add the `agent/grilled` label to it.
