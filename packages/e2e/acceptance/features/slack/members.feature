Feature: Slack members talk to a connected agent
  An owner connects an agent to a Slack conversation.
  Everyone Slack admits to that conversation can then reach the agent by mentioning the bot.

  Rule: Anyone in a connected channel gets an answer to a mention, without linking an account

    Example: Ben gets an answer from Ada's agent in #launch
      Given Ada has a running agent called "helper" that answers "Hello Ben"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Ben is in the Slack channel "#launch"
      When Ben mentions the bot in "#launch" with "hello"
      Then "helper" answers "Hello Ben" in the thread under Ben's message in "#launch"

  Rule: A mention in a conversation no agent is connected to is refused privately

    Example: Ben mentions the bot in #random
      Given Ben is in the Slack channel "#random"
      When Ben mentions the bot in "#random" with "anyone home?"
      Then Ben alone is told "No agent is connected to this channel yet" in "#random"
      And nothing is posted in "#random" for everyone to see

  Rule: A mention that opens with an agent's name reaches that agent, and any other mention reaches the default agent

    Example: Ben reaches notes by its name
      Given Ada has a running agent called "helper" that answers "From helper"
      And Jo has a running agent called "notes" that answers "From notes"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Jo has connected "notes" to the Slack channel "#launch"
      And Ben is in the Slack channel "#launch"
      When Ben mentions "notes" in "#launch" with "what did we decide?"
      Then "notes" answers "From notes" in the thread under Ben's message in "#launch"

    Example: A mention with no name reaches the agent connected first
      Given Ada has a running agent called "helper" that answers "From helper"
      And Jo has a running agent called "notes" that answers "From notes"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Jo has connected "notes" to the Slack channel "#launch"
      And Ben is in the Slack channel "#launch"
      When Ben mentions the bot in "#launch" with "what did we decide?"
      Then "helper" answers "From helper" in the thread under Ben's message in "#launch"

  Rule: Releasing the default agent leaves the conversation with none, and a mention with no name then names who is connected

    Example: #launch has no default once helper leaves
      Given Ada has a running agent called "helper"
      And Jo has a running agent called "notes"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Jo has connected "notes" to the Slack channel "#launch"
      And Ada has disconnected "helper" from the Slack channel "#launch"
      And Ben is in the Slack channel "#launch"
      When Ben mentions the bot in "#launch" with "who can help?"
      Then Ben alone is told that "#launch" has no default agent and "notes" is connected

  Rule: An agent connected to several channels answers each in its own channel

    Example: helper answers Ben in #ops and posts nothing in #launch
      Given Ada has a running agent called "helper" that answers "Hi there"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Ada has connected "helper" to the Slack channel "#ops"
      And Ben is in the Slack channel "#ops"
      When Ben mentions the bot in "#ops" with "hello from ops"
      Then "helper" answers "Hi there" in the thread under Ben's message in "#ops"
      And nothing is posted in "#launch" for everyone to see

  Rule: A disconnect releases only the channel it names
    Example: helper stays in #launch after Ada releases #ops
      Given Ada has a running agent called "helper"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Ada has connected "helper" to the Slack channel "#ops"
      When Ada disconnects "helper" from the Slack channel "#ops"
      Then Ada sees "helper" connected to the Slack channel "#launch"
      And Ada does not see "helper" connected to the Slack channel "#ops"

    Example: A mention in the released channel is refused
      Given Ada has a running agent called "helper"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Ada has connected "helper" to the Slack channel "#ops"
      And Ada has disconnected "helper" from the Slack channel "#ops"
      And Ben is in the Slack channel "#ops"
      When Ben mentions the bot in "#ops" with "anyone home?"
      Then Ben alone is told "No agent is connected to this channel yet" in "#ops"

  Rule: Deleting an agent releases every channel it was connected to

    Example: #launch has no agent once Ada deletes helper
      Given Ada has an agent called "helper"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Ben is in the Slack channel "#launch"
      When Ada deletes "helper"
      Then Ben finds no agent connected to "#launch"
