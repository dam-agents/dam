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

</supporting-info>
