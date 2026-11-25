@todo
Feature: Schedules
  A schedule fires a task on an agent by itself, on a recurrence or once, and wakes the agent when it sleeps.
  An optional precheck decides each occurrence before any model is woken.

  Rule: A schedule fires its task on its agent at each occurrence, even while the agent sleeps
  Rule: An occurrence inside quiet hours is skipped, not run later
  Rule: Running a schedule now leaves its next occurrence where it was
  Rule: An occurrence the precheck declines starts no turn, and is counted as declined
  Rule: An owner sees the schedules of all their agents in one list
