Feature: Managing a Slack conversation's agents from Slack
  People manage the agents of a conversation with the platform's slash command.
  A linked account decides who may change a connection, never who may talk to an agent.

  Rule: Anyone can ask to connect an agent to a conversation

    Example: Ben is offered a way to connect an agent to #random
      Given Ben is in the Slack channel "#random"
      When Ben runs the Slack command "bind" in "#random"
      Then Ben alone is told "Connect an agent to this channel" in "#random"

  Rule: Only the person who connected an agent, or its owner, disconnects it from Slack

    Example: Ben, with no linked account, cannot disconnect helper
      Given Ada has a running agent called "helper"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Ben is in the Slack channel "#launch"
      When Ben runs the Slack command "unbind" in "#launch"
      Then Ben alone is told "Link your account first" in "#launch"
      And Ada sees "helper" connected to the Slack channel "#launch"

    Example: Ben, linked, still cannot disconnect Ada's agent
      Given Ada has a running agent called "helper"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Ben has linked a Slack account
      And Ben is in the Slack channel "#launch"
      When Ben runs the Slack command "unbind" in "#launch"
      Then Ben alone is told "can disconnect it" in "#launch"
      And Ada sees "helper" connected to the Slack channel "#launch"

    Example: Ada disconnects helper from #launch in Slack
      Given Ada has a running agent called "helper"
      And Ada has connected "helper" to the Slack channel "#launch"
      When Ada runs the Slack command "unbind" in "#launch"
      Then Ada does not see "helper" connected to the Slack channel "#launch"

  Rule: Only an agent's owner makes it a conversation's default agent

    Example: Jo makes notes the default agent of #launch
      Given Ada has a running agent called "helper"
      And Jo has a running agent called "notes"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Jo has connected "notes" to the Slack channel "#launch"
      When Jo runs the Slack command "default notes" in "#launch"
      Then Jo sees "notes" as the default agent of the Slack channel "#launch"

    Example: Ben cannot make notes the default agent of #launch
      Given Ada has a running agent called "helper"
      And Jo has a running agent called "notes"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Jo has connected "notes" to the Slack channel "#launch"
      And Ben has linked a Slack account
      When Ben runs the Slack command "default notes" in "#launch"
      Then Ben alone is told "owner can make it the default agent" in "#launch"
      And Ada sees "helper" as the default agent of the Slack channel "#launch"

  Rule: Commands run only from the slash command, and a mention that reads like one still reaches the agent, with a private tip

    Example: Ben mentions the bot with "who"
      Given Ada has a running agent called "helper" that answers "Hello Ben"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Ben is in the Slack channel "#launch"
      When Ben mentions the bot in "#launch" with "who"
      Then "helper" answers "Hello Ben" in the thread under Ben's message in "#launch"
      And Ben alone is told "Commands run only as" in "#launch"

  Rule: Help, and any word the command does not know, show how to use it

    Example: Ben asks for help in #launch
      Given Ben is in the Slack channel "#launch"
      When Ben runs the Slack command "help" in "#launch"
      Then Ben alone is told "Usage:" in "#launch"
