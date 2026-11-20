Feature: Artifacts an agent publishes
  An agent hands its work to its owner as an artifact in the owner's library.

  Rule: An artifact an agent publishes reaches its owner's library

    @ui
    Example: Ada finds the report helper published
      Given Ada has a running agent called "helper" that publishes an artifact "Weekly report"
      When Ada sends "publish the weekly report" to "helper"
      Then Ada sees the artifact "Weekly report" in the library

  Rule: The library names the agent that published an artifact

    Example: The weekly report comes from helper
      Given Ada has a running agent called "helper" that publishes an artifact "Weekly report"
      When Ada sends "publish the weekly report" to "helper"
      Then Ada sees that "helper" published the artifact "Weekly report"
