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

  Rule: The Generalist makes a plain agent at once

    @ui
    Example: Ada makes an agent from the Generalist
      When Ada makes an agent from the Generalist starter kit, known here as "first"
      Then Ada sees an agent called "first"

  Rule: An owner deletes an agent

    @ui
    Example: Ada deletes scratch
      Given Ada has an agent called "scratch"
      When Ada deletes "scratch"
      Then Ada does not see an agent called "scratch"

  Rule: An agent that has gone to sleep wakes to answer its owner

    @ui
    Example: helper wakes to answer Jo
      Given Jo has a running agent called "helper" that answers "Hello Jo"
      And "helper" has gone to sleep
      When Jo sends "hello" to "helper"
      Then Jo sees "helper" answer "Hello Jo"

  Rule: An agent that has gone to sleep reads as idle

    @ui
    Example: Jo sees helper idle while it sleeps
      Given Jo has a running agent called "helper"
      And "helper" has gone to sleep
      When Jo looks at the agents
      Then Jo sees "helper" idle
