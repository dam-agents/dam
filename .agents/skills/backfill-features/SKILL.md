---
name: backfill-features
description: Write the acceptance suite's feature files for one capability the product already has, from its architecture page, as Rules with concrete Examples that run on every pull request, and retire the e2e specs they cover.
  Use when asked to backfill, cover or specify an existing capability in Gherkin, or to move an e2e spec of product behaviour into the acceptance suite — "backfill connections", "write the feature files for schedules".
  Not for new behaviour: a change the product does not have yet takes an Example Map in grilling and a spec pull request (docs/guidelines/acceptance-criteria.md).
---

# Backfill feature files

One capability per pull request.
The capability's feature files state what the product **should** do, from its architecture page, never what the running system happens to do: a backfill that copies the system's behaviour turns its bugs into the spec.
A person of the code owners approves what the Examples mean; you write them, run them, and report what you found.

Read first: [`docs/guidelines/acceptance-criteria.md`](../../../docs/guidelines/acceptance-criteria.md) (how an Example is written), [`docs/architecture/e2e.md`](../../../docs/architecture/e2e.md) → **Acceptance suite** (how the suite runs), and the glossary, [`docs/ubiquitous-language.md`](../../../docs/ubiquitous-language.md).

## 1. Read the capability

- **The source** is the capability's page under `docs/architecture/` — the source of truth for its behaviour — and the glossary's terms for it.
- **The hints** are the e2e specs that cover it today (`packages/e2e/integration/src/tests/`) and the QA profile's journeys (`.quality-inspector/qi-profile-dam/scenarios/`): they show the main paths, never what the behaviour should be.
- List what the page states that a user or a client **can see**: through the web UI, the API, the CLI, Slack or GitHub.
  Leave out what only the system sees — pods, rows, logs, internal protocol — which the integration specs keep.

## 2. Write the Rules and Examples

- `features/<capability>/<subject>.feature`: one Feature per subject, its Rules, each with at least one concrete Example.
- An Example follows the guideline: named personas (Ada, Ben, Jo), names and values, one When, Given/When/Then in order, the domain's words, no part of the screen.
- Tag `@ui` or `@cli` when the behaviour lives on that surface too; every Example runs through the API.
- A user's story across several actions is a journey in `features/journeys/`, built only from steps the Examples use.
- `check:features` and `check:steps` hold the files to these rules.

## 3. Drive them

- **Reuse steps** before writing one: `src/steps/<capability>.steps.ts`, one line each, a call into the Driver.
- **A new action or observation** is a method of the capability on each surface that needs it: `src/drivers/api/<capability>.ts`, `src/drivers/ui/<capability>.ts`.
  Drivers act only through the product's public interfaces; `check:boundary` refuses an import of its code.
  A capability a surface cannot reach skips its step with a reason.
- **Given steps set state up through the API** (`setup` in `src/fixtures.ts`), on warm mock agents; an agent's answer and the platform tool it calls are scripted through its environment.

## 4. Run them, and keep what fails

Run the suite on a cluster: the pull request's e2e lane, or `e2e:loop` and `mise run //packages/e2e/acceptance:run` against a warm one.

- **A red Example is never reworded to pass.**
  It stays as written, tagged `@wip` with a comment line that names why, and runs as an expected failure.
  File a bug for it — or, where your instructions want a person's approval before filing, draft it in the pull request body — and name it in the comment line.
- **The page and the system disagree, and you cannot tell which is right**: write no Example for it.
  Put a **Question** in the pull request body, saying what the page states and what the system does; a person decides whether it is a bug or a stale page.
- **Only a person changes an Example's text** once you reported it red.

## 5. Show each Rule can fail

A backfilled Example passes on its first run, so nothing yet shows it checks anything.
For each Rule, break the behaviour once — revert the line that implements it, or switch off its check — run the Rule's Examples against that build, and confirm they fail at the step you predicted.
Put the evidence in the pull request body: the change you made to break it, the predicted step, and the failure's line from the run.
Throw the breaking change away; it never lands.

## 6. Retire what the Examples cover

When the Examples cover the behaviour of an e2e spec of product behaviour, delete that spec in the same pull request.
Use common sense: an assertion that checks nothing a user or a client can see is dropped, not moved.
Say in the body how the Examples differ from the deleted spec — what they check that it did not, and what they leave out on purpose.
A spec of infrastructure or protocol mechanics stays in `packages/e2e/integration`.

## 7. The pull request

- Title: `test(acceptance): backfill <capability>`.
- Body, in this order:
  - **Source** — the architecture page and the sections each Rule came from.
  - **Questions** — every disagreement between the page and the system, for a person to decide.
  - **Work in progress** — every `@wip` Example, with its bug.
  - **Evidence** — per Rule, the break and the failure at the predicted step.
  - **Retired** — the deleted specs and how the Examples differ.
  - **Testing** — the checks and the e2e run.
- The issue line the repository asks for, and the code owners' review: the feature files need a person's approval.
