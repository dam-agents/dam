# An agent in Slack files the GitHub issue a person asks for

## AC-1 — the agent is connected to GitHub and to the Slack channel

Given the owner signed in, with a new agent made from a Claude Code template, a model connection, and a GitHub connection made with the sandbox token, and the owner's Slack account linked to the test person
When they pick the sandbox Slack channel by name and connect the agent to it
Then the agent's page shows the GitHub connection and the Slack channel as connected

## AC-2 — the agent answers in the thread with the new issue

Given that agent
When the test person mentions the agent in the sandbox channel and asks it to file an issue in the sandbox repository, titled with this run's id
Then within five minutes the agent replies in that thread with a link to an issue in the sandbox repository whose title holds the run's id

## AC-3 — the agent's chat shows the request and the issue

Given that reply
When the owner opens the agent's chat in DAM
Then it shows the test person's Slack message and the issue the agent filed
