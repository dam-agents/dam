Feature: API keys
  An owner makes API keys for scripts and other tools.
  A key acts as its owner, but only within its scopes and the agents it is bound to.

  Rule: A key with any agent scope reads the owner's agents

    Example: Ada's reading key sees helper
      Given Ada has a running agent called "helper"
      And Ada has an API key called "ci" that may read agents
      When Ada looks at the agents with the key "ci"
      Then Ada sees "helper" through the key

  Rule: Only a key that may manage agents makes, changes and deletes them

    Example: Ada's reading key cannot make an agent
      Given Ada has an API key called "ci" that may read agents
      When Ada makes an agent called "scratch" with the key "ci"
      Then Ada is refused as not allowed

    Example: Ada's operating key cannot change an agent
      Given Ada has an agent called "scratch"
      And Ada has an API key called "runner" that may operate agents
      When Ada describes "scratch" as "nightly builds" with the key "runner"
      Then Ada is refused as not allowed

    Example: Ada's managing key makes an agent
      Given Ada has an API key called "admin" that may manage agents
      When Ada makes an agent called "scratch" with the key "admin"
      Then Ada sees an agent called "scratch"

    Example: Ada's managing key changes an agent
      Given Ada has an agent called "scratch"
      And Ada has an API key called "admin" that may manage agents
      When Ada describes "scratch" as "nightly builds" with the key "admin"
      Then Ada sees "scratch" described as "nightly builds"

    Example: Ada's managing key deletes an agent
      Given Ada has an agent called "scratch"
      And Ada has an API key called "admin" that may manage agents
      When Ada deletes "scratch" with the key "admin"
      Then Ada does not see an agent called "scratch"

  Rule: A key that may operate agents puts files in a running agent, and a reading key does not

    Example: Ada's operating key puts a file in helper
      Given Ada has a running agent called "helper"
      And Ada has an API key called "runner" that may operate agents
      When Ada puts a file in "helper" with the key "runner"
      Then the file is in "helper"

    Example: Ada's reading key cannot put a file in helper
      Given Ada has a running agent called "helper"
      And Ada has an API key called "ci" that may read agents
      When Ada puts a file in "helper" with the key "ci"
      Then Ada is refused as not allowed

  Rule: A key that may read connections reads them, and neither changes them nor reads agents

    Example: Ada's connections key sees the weather connection
      Given Ada has a connection called "weather" to "api.weather.test"
      And Ada has an API key called "audit" that may read connections
      When Ada looks at the connections with the key "audit"
      Then Ada sees the connection "weather" through the key

    Example: Ada's connections key cannot remove a connection
      Given Ada has a connection called "weather" to "api.weather.test"
      And Ada has an API key called "audit" that may read connections
      When Ada removes the connection "weather" with the key "audit"
      Then Ada is refused as not allowed

    Example: Ada's connections key cannot look at the agents
      Given Ada has an API key called "audit" that may read connections
      When Ada looks at the agents with the key "audit"
      Then Ada is refused as not allowed

  Rule: A key bound to some agents reaches only those

    Example: Ada's key for helper cannot read scratch
      Given Ada has a running agent called "helper"
      And Ada has an agent called "scratch"
      And Ada has an API key called "ci" that may read agents, bound to "helper"
      When Ada reads "scratch" with the key "ci"
      Then Ada is refused as not allowed

  Rule: Deleting an agent drops it from every key bound to it

    Example: Ada's key for scratch no longer names it once scratch is deleted
      Given Ada has an agent called "scratch"
      And Ada has an API key called "ci" that may read agents, bound to "scratch"
      When Ada deletes "scratch"
      Then the API key "ci" of Ada no longer names "scratch"

  Rule: A key that may manage agents covers every agent

    Example: Ada cannot make a managing key for helper alone
      Given Ada has a running agent called "helper"
      When Ada makes an API key that may manage agents, bound to "helper"
      Then Ada is told a key that may manage agents covers every agent

  Rule: A key cannot make or revoke keys

    Example: Ada's managing key cannot make another key
      Given Ada has an API key called "admin" that may manage agents
      When Ada makes an API key with the key "admin"
      Then Ada is refused as not allowed

  Rule: A revoked key is refused as if nobody signed in

    Example: Ada's revoked key cannot look at the agents
      Given Ada has an API key called "ci" that may read agents
      And Ada has revoked the API key "ci"
      When Ada looks at the agents with the key "ci"
      Then Ada is refused as not signed in
