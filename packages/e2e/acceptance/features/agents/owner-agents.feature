Feature: An owner's agents
  An owner talks to their agents in a chat.
  Nobody else sees an owner's agents.

  Rule: An agent answers its owner's message in the chat

    @ui
    Example: Ada gets an answer to a message
      Given Ada has a running agent called "helper" that answers "Hello Ada"
      When Ada sends "hello" to "helper"
      Then Ada sees "helper" answer "Hello Ada"

  Rule: An owner's agents are listed for that owner only

    Example: Ada sees the agent Ada owns
      Given Ada has a running agent called "helper"
      When Ada looks at the agents
      Then Ada sees an agent called "helper"

    @ui
    Example: Ben does not see Ada's agent
      Given Ada has a running agent called "helper"
      And Ben has a running agent called "notes"
      When Ben looks at the agents
      Then Ben sees an agent called "notes"
      And Ben does not see an agent called "helper"
