@todo
Feature: An agent's skills
  An owner connects skill sources, git repositories that hold skills, and installs their skills on an agent.
  An agent's skills list everything that sits on the agent, wherever it came from.

  Rule: An owner installs a skill from a connected source on an agent, and can uninstall it
  Rule: Applying a skill set adds its skills to an agent and removes none
  Rule: A skill a platform feature ships is shown as the platform's, and cannot be edited or deleted
  Rule: A skill written on an agent is published to its GitHub source as a pull request, whose state the skill then shows
  Rule: An owner hides a source on one agent, but not while a skill from it is installed there
