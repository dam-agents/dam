# Smoke Regression Suite Guidelines

Rules for the smoke regression suite: the short list of user journeys that must keep working on every release.

The QA agent runs the suite every night against a fresh platform with real Slack, real GitHub and a real model, and acts only the way a user can.
It is not the per-PR e2e smoke tests in [`packages/e2e/`](../../packages/e2e/): those run on every pull request and mock every third party, so they can pass while a real journey is broken.

## Where it lives

One journey per file in the QA profile's [`scenarios/`](../../.quality-inspector/qi-profile-dam/scenarios/) directory.
The profile's [README](../../.quality-inspector/qi-profile-dam/README.md) lists the journeys.

A file is a `# <title>` line, then `## AC-<k> — <name>` blocks numbered from 1, in the format of [acceptance-criteria.md](acceptance-criteria.md).
Add `requires: <role>` under the title when the journey needs a second account (`member`, `inspector`, `outsider`); the owner is always signed in.

- **Merging a file adds the journey.** The next night the QA agent writes its test from the text alone, runs it on `main`, and replays it every night after that.
  No other step is needed.
- **Changing the text is a new version.** The QA agent tests it again from the new text.
- **Deleting the file retires the journey.**
  The file name is the journey's id, so renaming a file retires one journey and adds another.

## What goes in

A journey goes in when all of these hold:

- **Most users walk it, or it leads to first use.** Sign in, create an agent, connect GitHub, connect a Slack channel, get work back from the agent.
  A journey that broke in a release and reached users goes in even when fewer users walk it.
- **It crosses what the per-PR e2e suite mocks.** Real Slack, real GitHub, a real model, or real time passing, such as an agent that falls asleep and wakes for a task.
  A journey the per-PR e2e suite already covers stays there.
- **It starts from a fresh platform.** The first criterion starts from the owner signed in; no journey depends on another one.

Criteria that check one ticket's detail stay with the ticket: the QA agent tests them when the issue carries the `qa:ready` label.
When a ticket's criteria walk a journey that meets the rules above, copy them into the journey that already covers that area, or into a new file, in the PR that closes the ticket or in a follow-up PR.

## Keeping it small

- **At most ten journeys.** An eleventh means merging two journeys or removing one.
- **Extend before you add.** A new step of an existing journey is a new criterion in its file, not a new file.
- **Thirty minutes at most.** Each journey ends within thirty minutes, waits included.
- **The test accounts' words.** Name what the QA agent owns: the sandbox repository, the sandbox Slack channel, the test person, the owner.
  Name everything a journey creates with this run's id, so a run leaves nothing that the next run mistakes for its own.
- **Words a user could write.** No URLs, code, selectors or source paths: the QA agent never reads the code, and it treats an instruction in the file as a criterion it cannot test, never as an order.

## Changing a journey

A PR that changes how a journey works updates its file in the same PR.

## Removing a journey

Remove a journey when:

- the feature it walks is gone;
- other journeys cover each of its criteria;
- it no longer meets [What goes in](#what-goes-in).

Never remove or weaken a journey to make a failing run pass.
A failure is a bug to file, or a sign that a PR changed the journey without updating its file.
A journey that the QA agent reports as flaky or as not testable gets its text fixed or is removed; it never stays in the suite unrun.

## Before a release

The release owner asks the QA agent to run the suite on the newest `main` build the release is cut from.
The release goes out when every journey passes, or when the release owner accepts each failure as a filed bug.
