Feature: The assistant
  A person may have an assistant: an agent the platform makes for them and names after the install.
  Its first chat greets them and offers ideas to start from.

  Rule: Switching the assistant on gives a person who has none an assistant with the install's name

    Example: Jo gets Dammy
      When Jo switches the assistant on
      Then Jo has an assistant called "Dammy"

  Rule: An agent a person made under the assistant's name keeps the name, so no assistant is made and that agent is never taken for one

    Example: The Dammy Ben made stays Ben's own agent
      Given Ben has an agent called exactly "Dammy"
      When Ben switches the assistant on
      Then Ben gets no assistant, and the "Dammy" Ben made stays Ben's own

  Rule: Switching the assistant off deletes nothing

    Example: Jo keeps Dammy after switching the assistant off
      Given Jo has an assistant
      When Jo switches the assistant off
      Then Jo still has the assistant among the agents

  Rule: An unused assistant's chat opens with a greeting and five ideas

    @ui
    Example: Dammy greets Jo
      Given Jo has an assistant
      When Jo opens the chat of the assistant
      Then Jo is greeted with "Hi Jo! I'm Dammy, your personal DAM agent." and offered the ideas "Artifact, Schedule, Knowledge base, Skill, DAM"

  Rule: Picking an idea fills the message without sending it

    @ui
    Example: Jo picks the artifact idea
      Given Jo has an assistant
      And Jo has opened the chat of the assistant
      When Jo picks the idea "Artifact"
      Then the message of Jo holds "Make my next PowerPoint deck the way I make them", not yet sent
