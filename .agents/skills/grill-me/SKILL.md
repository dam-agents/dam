---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, challenging it against the project's architecture docs and ubiquitous language, sharpening terminology, and cross-referencing the code. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

<what-to-do>

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing.

If a question can be answered by exploring the codebase, explore the codebase instead.

</what-to-do>

<supporting-info>

## Domain awareness

During codebase exploration, also look at existing documentation:

- `docs/architecture.md` — the main system architecture overview, plus the architecture pages it links under `docs/architecture/`. These are the source of truth for *why* the system is shaped the way it is.
- `docs/ubiquitous-language.md` — the glossary of domain terms and their definitions.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `docs/ubiquitous-language.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account' — do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

### Update `docs/ubiquitous-language.md` inline

When a term is resolved, update `docs/ubiquitous-language.md` right there. Don't batch these up — capture them as they happen.

### Keep a decision log

After each answer, append an entry to a log file outside the repo (the session scratchpad if there is one, otherwise a temp file):

```
<n>. <the question, one sentence>
   Recommended: <your recommended answer, one line>
   Decided: <"Accepted", or the user's answer in one line>
```

Leave out questions you answered yourself by exploring the code, and leave out your reasoning. Build the wrap-up from this file, not from memory: long sessions get compacted and lose the early questions.

## Wrap up

When no open branches remain, or the user asks to wrap up:

1. Show the decision log from the file, followed by an "Open questions" list of anything left unresolved. No intro line.
2. If the session was about a GitHub issue, ask whether to post the log to that issue as a comment. Post with `gh issue comment` only after the user approves the exact text, then add the `agent/grilled` label with `gh issue edit --add-label agent/grilled`. Never edit the issue body; if the body is now out of date, say so under "Open questions".
3. If the session was not about an issue, offer to file one with the `file-issue` skill, passing the log as its input. Add the `agent/grilled` label to the filed issue.

</supporting-info>
