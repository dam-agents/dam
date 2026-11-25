Feature: Connecting an agent to a Slack channel
  An owner connects an agent to a Slack channel from the platform.
  Only a channel the owner and the bot are both in can be connected, and the channel learns whose agent joined it.

  Rule: An owner connects an agent only to a channel the owner and the bot are both in
    Example: Ada connects helper to #launch, which Ada is in
      Given Ada has a running agent called "helper"
      And Ada has linked a Slack account
      And Ada is in the Slack channel "#launch"
      When Ada connects "helper" to the Slack channel "#launch"
      Then Ada sees "helper" connected to the Slack channel "#launch"
    Example: Ada cannot connect helper to #ops, which Ada is not in
      Given Ada has a running agent called "helper"
      And Ada has linked a Slack account
      And Ben is in the Slack channel "#ops"
      When Ada connects "helper" to the Slack channel "#ops"
      Then Ada is told "you and the bot are both in"
      And Ada does not see "helper" connected to the Slack channel "#ops"

    Example: Ada must link a Slack account before connecting helper
      Given Ada has a running agent called "helper"
      And Ada is in the Slack channel "#launch"
      When Ada connects "helper" to the Slack channel "#launch"
      Then Ada is told "Link your Slack account first"

  Rule: The channels offered for connecting are the ones the owner and the bot share
    Example: Ada is offered #launch and not #ops
      Given Ada has linked a Slack account
      And Ada is in the Slack channel "#launch"
      And Ben is in the Slack channel "#ops"
      When Ada looks at the Slack channels to connect
      Then Ada sees "#launch" among the Slack channels to connect
      And Ada does not see "#ops" among the Slack channels to connect

  Rule: A new connection is announced in the channel, naming its owner

    Example: #launch learns that helper is Ada's
      Given Ada has a running agent called "helper"
      And Ada has linked a Slack account
      And Ada is in the Slack channel "#launch"
      And Ben is in the Slack channel "#launch"
      When Ada connects "helper" to the Slack channel "#launch"
      Then Ben sees a notice in "#launch" that "helper" belongs to Ada

  Rule: Anyone in a conversation can see its agents and who owns them, without linking an account

    Example: Ben asks who is in #launch
      Given Ada has a running agent called "helper"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Ben is in the Slack channel "#launch"
      When Ben runs the Slack command "who" in "#launch"
      Then Ben alone is told that "helper" in "#launch" belongs to Ada and is the default agent
