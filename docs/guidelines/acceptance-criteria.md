# Acceptance Criteria Guidelines

Rules for writing the acceptance criteria of an issue.

Acceptance criteria say what a user sees when the work is done.
A tester checks them through the product the way a user would, without reading the code: a person, or the QA agent, which reads only the issue text and tests the running platform through the web UI, Slack and GitHub.
So the criteria are the whole spec the tester gets.
A criterion the tester cannot check from the outside gives no verdict.

## Which issues need them

| Type          | Acceptance criteria                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------- |
| Feature       | Always.                                                                                             |
| Bug           | Always: the expected behavior once the bug is fixed, starting from the reproduction steps.          |
| Task          | Only when a user can see the change. A refactor, a chore or an upgrade keeps a plain **Done when**. |
| Epic          | No. Its features carry them.                                                                        |
| Research Task | No. Its **Done when** names the answer and where it lands.                                          |

## When

After the grilling, not when the issue is filed: the criteria come out of the agreed design, and a criterion guessed from a one-line problem statement tends to encode a solution.
Until then **Done when** reads `TBD (after grilling)` and the issue carries the `needs-ac` label, which keeps it out of In Progress and away from the QA agent.
The grilling writes the criteria and removes the label ([work-process.md](work-process.md)).
Criteria the requester supplies when filing are reformatted to the format below, and need no label.

## Where

In the issue's `## Done when` section, one `### AC-<k> — <name>` block per criterion, numbered from 1.
Nothing else goes in that section.
The QA agent reads only this section when the issue has one, and the whole body when it does not.
When the issue text changes, the QA agent tests it again from the new text.

## Format

```markdown
## Done when

### AC-1 — <short name of the outcome>

Given <a state a user can set up through the web UI, Slack or GitHub>
When <one thing the user does>
Then <one outcome the user can see>
```

- **One outcome per criterion.** Split "the agent replies and the task is listed" into two criteria.
- **Only what a user can see.** Text or state in the web UI, a message in Slack, an issue or a pull request on GitHub.
  Pods, database rows, logs, environment variables and secrets are not outcomes a user sees; check them in the PR's own tests.
- **A start a user can reach.** "Given" names a state a user sets up through the product: signed in as the owner, an agent with a GitHub connection, a message in a Slack thread.
  Never a state only a developer can make, such as an edited config map or a seeded table.
- **The user's words.** Name screens, buttons and states as the UI shows them, in the [ubiquitous language](../ubiquitous-language.md).
  No file paths, component names, selectors, API fields or code.
- **Measurable.** Give a time limit for anything that takes time ("within five minutes").
  "Faster", "better", "works properly" or "as expected" cannot be checked; say what the user sees instead.
- **Exact text only when it matters.** "An error says the name is taken" lets the copy change; quote the message only when its words are the point.
- **Real third parties by name.** Say which service the criterion uses (GitHub, Slack, a model).
  The QA agent tests with its own throwaway GitHub and Slack accounts and a real model.
- **No instructions to the tester.** Every line describes the product.
  The QA agent treats a sentence such as "also post the result to …" as a criterion it cannot test, never as an order.

## A good example

```markdown
## Done when

### AC-1 — the agent answers in the thread with the new issue

Given the owner signed in, with an agent that has a GitHub connection and is connected to a Slack channel
When a person mentions the agent in that channel and asks it to file an issue in a repository the connection reaches
Then within five minutes the agent replies in that thread with a link to the new issue

### AC-2 — the agent's chat shows the request

Given that reply
When the owner opens the agent's chat
Then it shows the person's Slack message and the issue the agent filed
```

Each criterion has one start, one action and one outcome a user can see, with a time limit where time matters.
The second criterion starts from the first one's outcome, so the tester runs them in order.

## A bad example

```markdown
## Done when

- Slack requests work properly and are faster than before.
- The channel worker writes the request to the session table and the GitHub token never reaches the agent pod.
- The agent files the issue and answers in Slack and the chat is updated.
```

- The first bullet cannot be checked: "properly" and "faster" name no outcome.
- The second bullet checks internals a user never sees; it belongs in the PR's tests.
- The third bullet holds three outcomes and no start, no action and no time limit.

## Smoke regression suite

A criterion that tests a journey that must never break again can also go into the smoke regression suite.
The rules are in [smoke-regression-suite.md](smoke-regression-suite.md).
