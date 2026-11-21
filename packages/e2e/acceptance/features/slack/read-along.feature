Feature: An agent reading along in a Slack channel
  With ambient mode on, an agent reads every message in a channel and chimes in without a mention.
  Ambient mode belongs to one agent's connection to one channel.

  Rule: With ambient mode on, the agent reads unmentioned messages and answers in the thread under the one it answers, with no notice of its own

    Example: helper answers a question nobody addressed to it
      Given Ada has a running agent called "helper" that answers "It deploys to staging"
      And Ada has connected "helper" to the Slack channel "#launch" with ambient mode on
      And Ben is in the Slack channel "#launch"
      When Ben posts "does anyone know what the deploy script does?" in "#launch" without mentioning the bot
      Then "helper" answers "It deploys to staging" in the thread under Ben's message in "#launch"
      And Ben is told nothing privately in "#launch"
      And nothing reacts to Ben's message in "#launch"

  Rule: Ambient mode is off unless the owner turns it on, and then an unmentioned message reaches no agent

    Example: Ben's chatter in #launch stays unanswered
      Given Ada has a running agent called "helper" that answers "I am here"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Ben is in the Slack channel "#launch"
      When Ben posts "chatting amongst ourselves" in "#launch" without mentioning the bot
      Then nobody answers Ben's message in "#launch" within one minute

  Rule: Turning ambient mode on or off is confirmed privately and never announced in the channel

    Example: Ada turns ambient mode on for helper in #launch from Slack
      Given Ada has a running agent called "helper"
      And Ada has connected "helper" to the Slack channel "#launch"
      When Ada runs the Slack command "ambient on" in "#launch"
      Then Ada alone is told "Ambient mode turned on" in "#launch"
      And nothing is posted in "#launch" for everyone to see
      And Ada sees "helper" reading along in the Slack channel "#launch"

    Example: Ada turns ambient mode on for helper from the platform
      Given Ada has a running agent called "helper"
      And Ada has connected "helper" to the Slack channel "#launch"
      When Ada connects "helper" to the Slack channel "#launch" with ambient mode on
      Then Ada sees "helper" reading along in the Slack channel "#launch"
      And nothing is posted in "#launch" for everyone to see

  Rule: Only the person who connected the channel or the agent's owner changes ambient mode

    Example: Ben cannot turn ambient mode on for helper
      Given Ada has a running agent called "helper"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Ben has linked a Slack account
      And Ben is in the Slack channel "#launch"
      When Ben runs the Slack command "ambient on" in "#launch"
      Then Ben alone is told "can change ambient mode" in "#launch"
      And Ada sees "helper" answering only mentions in the Slack channel "#launch"
