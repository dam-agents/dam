# DAM context

Read this file when the repository is DAM.
It names the project's own sources for the steps in `SKILL.md` and the other references.
An issue with the `needs design` label is a candidate for this skill.

## Design rules, words and components

- `.design-desk/dam/PROFILE.md` says who the people are, what the main screens are, and the design rules.
  Obey it in every concept.
- "Words users read" and "Retired words" in `docs/ubiquitous-language.md` give the words.
  Never use a retired word.
- `docs/guidelines/code/icons-and-tooltips.md` gives one icon per action, and the tooltip rules.
- Both themes ship, so a spec says what changes in each.

## Surfaces

The surfaces are the web UI, the `dam` CLI, Slack and Telegram.
They also include the GitHub issues and pull requests that an agent writes, and shared pages (an artifact link, a public agent).
Read `docs/architecture/cli.md` and `docs/architecture/channels.md` before you write copy for them.
Copy never holds the brand as a literal.

## Research

- Start the app with the `cluster-ops` skill.
- The research steps of the `develop` skill cover duplicate issues, the history of the area, and deliberate decisions.
- Ask the questions in the rhythm of the `grill-me` skill.
- Usage analytics (`docs/architecture/usage-tracking.md`) hold the adoption funnel and the use of features.
  Only the `platform-inspector` role can read them, so ask the user for a read.

## While the person is away

Reuse these devices before you add a new one:

- Home shows what changed since the person last looked, and its approvals panel shows what waits for them.
- The sidebar shows the agents, and the activity under them.
- A blue dot marks unread, and an amber dot marks a session that waits for approval.
- The status indicator shows a hibernated agent.
  A hibernated agent does not run, and some surfaces still render its stored state.
  Design what the person sees and can do then.

## What must change with it

- The journeys and helpers in `.quality-inspector/qi-profile-dam/` that use a flow, a label, a dialog or an API that the spec changes.
- The part of `.design-desk/dam/` that a moved screen or a new role of a `packages/ui` folder changes.
- The architecture pages whose behavior the spec changes.
- The words that the glossary needs.

## Delivering

The proposal feeds `grill-me`.
Its flow and states become the observable outcomes of the acceptance criteria.
Posted text cites staging, never the cluster on your machine.
