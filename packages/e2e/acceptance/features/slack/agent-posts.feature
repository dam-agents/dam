Feature: An agent's posts in Slack
  An agent posts to Slack through the platform, as the bot, signed with its own name.

  Rule: An agent posts beyond its connected channels only where its owner is a member

    Example: helper announces the release in #ops, where Ada is
      Given Ada has a running agent called "helper" that posts "Release 2.4 is out" to the Slack channel "#ops"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Ada is in the Slack channel "#ops"
      And Ben is in the Slack channel "#ops"
      When Ada sends "announce the release" to "helper"
      Then Ben sees "helper" post "Release 2.4 is out" in "#ops"

    Example: helper cannot post in #ops, where Ada is not
      Given Ada has a running agent called "helper" that posts "Release 2.4 is out" to the Slack channel "#ops"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Ben is in the Slack channel "#ops"
      When Ada sends "announce the release" to "helper"
      Then nothing is posted in "#ops" for everyone to see
