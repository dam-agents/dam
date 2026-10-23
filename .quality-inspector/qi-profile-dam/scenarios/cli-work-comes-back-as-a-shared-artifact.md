# Work asked for from the command line comes back as a shared artifact

requires: member

## AC-1 — the agent answers a request sent from the command line

Given a fresh platform and the owner signed in, with an agent made from a Claude Code template and a model connection, named with this run's id, and an API key the owner created in Settings
When the owner, with DAM's command-line tool signed in with that key, asks the agent to publish a one-page artifact titled with this run's id that lists three facts about the agent's workspace
Then within ten minutes the command ends with the agent's answer

## AC-2 — Home shows the work done from the command line

Given that answer
When the owner opens Home
Then the agent named with the run's id is shown among what changed, with the session the command started

## AC-3 — the artifact is in the owner's library

Given that answer
When the owner opens Artifacts
Then an artifact titled with the run's id is listed, and opening it shows a page with three facts

## AC-4 — the agent's change is a new version

Given that artifact
When the owner asks the agent in its chat to add a fourth fact to that artifact
Then within ten minutes the artifact shows two versions, the newest marked latest and showing four facts

## AC-5 — a public link opens for another account

Given that artifact
When the owner shares it as Public and the member opens its share link
Then the member sees the artifact with four facts

## AC-6 — making it private closes the link

Given that share link
When the owner sets the artifact back to Private and the member opens the same link again
Then the member does not see the artifact's facts

## AC-7 — the usage report counts the agent's work

Given the agent's two answers
When the owner opens the usage analytics report
Then it shows model usage of the agent named with the run's id

## AC-8 — the member has no usage report

Given that report
When the member opens the usage analytics report
Then the member sees the "We are sorry" page and none of the owner's usage
