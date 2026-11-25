@todo
Feature: Starter kits
  A starter kit sets up a new agent for one job: the connections, channels and schedules it needs, and an onboarding in which the agent asks its owner for what only they can supply.
  Kits come from the platform's catalogs, or from a link to a public GitHub repository.
  The Generalist, the plain agent, is in agents.feature.

  Rule: A kit that requires a connection the owner does not hold makes no agent
  Rule: An agent made from a kit with an onboarding shows as onboarding until it reports itself set up
  Rule: An agent still onboarding runs none of its recurring schedules
  Rule: A kit read from a link says nobody on the platform reviewed it, and names its repository and commit
  Rule: An agent made from a kit is offered an update when the kit's definition moves on
