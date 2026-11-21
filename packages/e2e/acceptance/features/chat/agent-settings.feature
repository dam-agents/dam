Feature: An agent's settings from its chat
  An agent's settings open over its chat, so the conversation stays where it was.

  Rule: An agent's settings open over its chat from its answer

    @ui
    Example: Ada opens the settings of helper from its answer
      Given Ada has a running agent called "helper" that answers "Hello Ada"
      And Ada has an answer from "helper" to "hello" in the chat
      When Ada opens the settings of "helper" from its answer
      Then Ada sees the settings of "helper" over its chat

  Rule: The old address of an agent's page opens its chat with its settings at that section

    @ui
    Example: Ada opens the old address of the connections of helper
      Given Ada has a running agent called "helper"
      When Ada opens the old address of the connections of "helper"
      Then Ada sees the settings of "helper" over its chat, at its connections
