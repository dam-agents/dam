# An agent in Slack opens the pull request a person asks for

## AC-1 — the agent is connected to GitHub and to the Slack channel

Given the owner signed in, with a new agent made from a Claude Code template, a model connection, and a GitHub connection made with the sandbox token, and the owner's Slack account linked to the test person
When they pick the sandbox Slack channel by name and connect the agent to it
Then the agent's page shows the GitHub connection and the Slack channel as connected

## AC-2 — the agent answers in the thread with the new pull request

Given that agent
When the test person mentions the agent in the sandbox channel and asks it to add a file named with this run's id to the sandbox repository through a pull request titled with this run's id
Then within ten minutes the agent replies in that thread with a link to a pull request of the sandbox repository whose title holds the run's id

## AC-3 — the pull request adds the file

Given that reply
When the test person opens the linked pull request on GitHub
Then it is open and adds a file named with the run's id

## AC-4 — the agent's chat shows the request and the pull request

Given that reply
When the owner opens the agent's chat in DAM
Then it shows the test person's Slack message and the pull request the agent opened
