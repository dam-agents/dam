Feature: An agent's posts in Slack
  An agent posts to Slack through the platform, as the bot, signed with its own name.

  Rule: An agent posts only in the Slack channels it is connected to

    Example: helper announces the release in #launch, which it is connected to
      Given Ada has a running agent called "helper" that posts "Release 2.4 is out" to the Slack channel "#launch"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Ben is in the Slack channel "#launch"
      When Ada sends "announce the release" to "helper"
      Then Ben sees "helper" post "Release 2.4 is out" in "#launch"

    Example: helper cannot post in #ops, where Ada is but helper is not connected
      Given Ada has a running agent called "helper" that posts "Release 2.4 is out" to the Slack channel "#ops"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Ada is in the Slack channel "#ops"
      And Ben is in the Slack channel "#ops"
      When Ada sends "announce the release" to "helper"
      Then nothing is posted in "#ops" for everyone to see
