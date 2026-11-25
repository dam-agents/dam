@todo
Feature: Spend limits
  An owner sets daily limits on what their agents spend on models: for one agent, for all of them together, or on one connection.
  The operator's spend ceiling caps each user's spend for the day, and nothing continues past it.

  Rule: An agent at a spend limit has its model calls refused until the owner continues the limit or the day ends
  Rule: Only the owner continues a spend limit, for one more limit's worth that day
  Rule: An agent cannot set, change or continue the spend limits that count its calls
  Rule: Nothing continues an agent past its owner's spend ceiling until the day ends
  Rule: Work nobody watches does not start while its agent is at a spend limit, and whoever waits for it is told why
