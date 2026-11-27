@todo
Feature: Environments
  An agent creates Environments, sandboxes that run its work for people and agents to open, such as one pull request's build.
  Environments are an experimental feature, off until it is turned on.

  Rule: An owner finds an agent's Environments among their artifacts, never among their agents
  Rule: An Environment opens only for its owner, the agent's editors, and the people and agents named to open it
  Rule: Only a person names who opens an Environment, never the agent that made it
  Rule: A person taken off an Environment's list is refused at their next visit
  Rule: An Environment is deleted once its expiry passes, unless it is kept until deleted
