# A user's full day: from login to a scheduled Slack message

## AC-1 — the owner creates an agent

Given a fresh platform and the owner signed in through its sign-in page
When they create an agent from a Claude Code template with a model connection, named with this run's id
Then the agent is listed among the owner's agents under that name

## AC-2 — the agent is connected to GitHub through the sign-in

Given that agent
When the owner connects GitHub with Connect with GitHub, signs in as the sandbox test user, and grants the connection to the agent
Then the agent's page shows the GitHub connection with the sandbox test user's account

## AC-3 — the agent opens a pull request asked for in its chat

Given that agent with the GitHub connection
When the owner asks it in its chat to add a file named with this run's id to the sandbox repository and open a pull request titled with this run's id
Then within ten minutes the chat shows a link to a pull request of the sandbox repository, and that pull request is open on GitHub with the run's id in its title

## AC-4 — the agent is connected to the Slack channel

Given that agent
When the owner connects it to the sandbox Slack channel
Then the agent's page shows the Slack channel as connected

## AC-5 — the agent falls asleep before its task

Given that agent, set to sleep after being idle for 5 minutes
When the owner schedules a one-time task fifteen minutes from now that tells the agent to post a short status of that pull request to the Slack channel, and then leaves the platform alone
Then before the scheduled time the agent is shown as Asleep in the owner's list of agents

## AC-6 — the scheduled task posts to Slack with nobody watching

Given that scheduled task and the agent asleep
When the scheduled time passes with nobody using the platform
Then within ten minutes of it a message from the agent appears in the sandbox Slack channel with a link to that pull request
