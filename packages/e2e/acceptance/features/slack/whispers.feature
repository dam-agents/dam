Feature: Whispering to an agent in Slack
  Anyone in a connected conversation can reach one of its agents privately.
  Only the whisperer sees the answer.

  Rule: Anyone in a connected conversation whispers to its agent, and only the whisperer sees the answer

    Example: Ben whispers to helper in #launch
      Given Ada has a running agent called "helper" that answers "On track"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Ben is in the Slack channel "#launch"
      When Ben whispers "is the release on track?" to "helper" in "#launch"
      Then Ben alone sees "helper" answer "On track" in "#launch"
      And nothing is posted in "#launch" for everyone to see

  Rule: An owner can turn an agent's whispers off, and a whisper to it is then refused

    Example: Ben's whisper to helper is refused
      Given Ada has a running agent called "helper" that answers "On track"
      And Ada has connected "helper" to the Slack channel "#launch"
      And Ada has turned whispers off for "helper"
      And Ben is in the Slack channel "#launch"
      When Ben whispers "is the release on track?" to "helper" in "#launch"
      Then Ben alone is told "are turned off" in "#launch"
      And nothing is posted in "#launch" for everyone to see
