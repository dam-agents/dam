# Acceptance Criteria Guidelines

Rules for writing what an issue's change must do, as an Example Map of Rules, Examples and Questions.

The feature files in [`packages/e2e/acceptance/features/`](../../packages/e2e/acceptance/features/) are the spec of what the product does, and every Example in them runs on every pull request ([e2e suite](../architecture/e2e.md#acceptance-suite)).
An issue's Example Map is a draft of a change to that spec: the pull request that specifies the change copies its Examples into the feature files.
"Acceptance criteria" is the collective name for an issue's Rules and Examples; it is not the [Acceptance](../ubiquitous-language.md#terms-bounded-context) a user gives the Terms.

## The parts

- **Rule** — one sentence that states a behaviour in general: "Only the agent's owner can change its setup."
- **Example** — one concrete case that illustrates a Rule, in Given/When/Then form, with named people, names and values.
- **Question** — something nobody has decided yet.
  An issue with an open Question is not ready: its Examples would encode a guess.

## Which issues carry them

- **Feature** — an Example Map, written in grilling with the person who asked, before anyone builds it.
- **Bug** — the Example that reproduces it: what should happen, stated so that it fails today.
- **Task** — none; a plain **Done when** names the end state, and every existing Example stays green.
- **Epic** and **research task** — none; their child issues follow the rows above.

## Where

In the issue's `## Done when` section: one `### Rule:` block per Rule, each with its Examples, then a `### Questions` block while any is open.
Nothing else goes in that section.
Until the spec pull requests replace per-ticket testing, the QA agent still reads this section when an issue carries `qa:ready`, and the whole body when it has none.

## Format

```markdown
## Done when

### Rule: Only the agent's owner can change its setup

Example: Ben cannot change the setup of Ada's agent
Given Ada owns the agent "triage" and Ben is a member of it
When Ben opens the setup of "triage"
Then Ben sees the setup read-only, with Ada named as the one who can change it

### Questions

- Can an owner hand the setup to a member?
```

## Writing an Example

- **Concrete.** Name the people, the agents and the values: "Ada", "triage", "Hello Ada", never "a user" or "an agent".
  The suite's personas are Ada, Ben and Jo, and Kim, a newcomer who has never accepted the Terms of Use.
  Concrete data is what makes an Example check one thing.
- **One action.** One When; the Given steps set the state up, the Then steps check the outcome.
  A long story is a journey, not an Example (see [Journeys](#journeys)).
- **The domain's words, never the screen's.** Write in the words of the [glossary](../ubiquitous-language.md): "Ben opens the setup", not "Ben clicks the gear button".
  No click, tap, press, button, field, textbox, dropdown, checkbox, hover, scroll, modal, dialog, sidebar, menu or icon: a redesign changes how a step is driven, not what the Example states.
  `check:features` refuses these words in the feature files.
- **Any start a public interface can make.** A Given is a state, set up the fastest way through the web UI, the API or the CLI, never a seeded table or an edited config map.
- **An outcome a user or a client can see.** Text or state in the web UI, an answer of the API or the CLI, a message in Slack, an issue or a pull request on GitHub.
  Pods, database rows, logs and environment variables are no outcome; the pull request's own tests check them.
- **The surface, when it matters.** Every Example runs through the API; mark one `@ui` or `@cli` when the behaviour lives on that surface too.
- **Measurable.** Give a time limit for anything that takes time ("within five minutes"); "works", "faster" and "as expected" give no verdict.
- **No instructions to the tester.** Every line describes the product.

## From the map to the feature file

A feature's Examples merge first, in a pull request of their own: the spec pull request adds them to the capability's feature file, tagged `@wip`, and a code owner approves what they mean.
A `@wip` Example runs as an expected failure until the implementation pull request removes the tag and makes it pass.
A bug's Example and its fix share one pull request, whose body shows the Example failing before the fix.

## Journeys

A journey is a user's story across several actions, such as a new owner's first use.
It lives in `features/journeys/`, is built from the Examples' steps, and names the surfaces it runs on.
The QA profile's Markdown journeys are a bridge that shrinks as Gherkin journeys replace them ([smoke regression suite](smoke-regression-suite.md)).

## A bad Example

```markdown
### Rule: Slack works

Example: the agent answers
Given an agent
When a user clicks the mention button and the agent replies and the task is listed
Then everything works properly and fast
```

- The Rule states no behaviour, and the Example names nobody and nothing.
- "Clicks the mention button" names the screen.
- The When holds three actions, and the Then can give no verdict.
