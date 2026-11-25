@todo
Feature: Tool approval
  Tool approval decides whether a tool call asks a person, is left to a classifier, or runs unasked.
  A session picks its own, and an agent may hold one for all its sessions, set from the CLI.

  Rule: A session's tool approval applies to that session alone
  Rule: A session that picks no tool approval starts on its agent's
  Rule: A change to an agent's tool approval reaches a running session with its next prompt
  Rule: A channel turn or a schedule fire never waits on a person, even on an agent set to ask
  Rule: A session on a harness with one way to run tools, or none, offers no choice of tool approval
