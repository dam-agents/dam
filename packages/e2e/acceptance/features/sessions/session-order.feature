Feature: The order of an agent's sessions
  An agent's sessions are listed by their last activity, newest first.

  Rule: An agent's sessions are listed by last activity, newest first

    @ui
    Example: helper's newest session is listed first
      Given Ada has a running agent called "helper" that answers "noted"
      And Ada has talked to "helper" in sessions opened with "first, second, third", in that order
      When Ada opens the sessions of "helper"
      Then Ada sees the sessions of "helper" listed as "third, second, first"

  Rule: A new turn in an old session, or a new session, puts that session at the top

    @ui
    Example: A new message moves helper's oldest session to the top
      Given Ada has a running agent called "helper" that answers "noted"
      And Ada has talked to "helper" in sessions opened with "first, second, third", in that order
      When Ada sends "again" in the session "first" of "helper"
      Then Ada sees the sessions of "helper" listed as "first, third, second"

    @ui
    Example: A new session of helper is listed first
      Given Ada has a running agent called "helper" that answers "noted"
      And Ada has talked to "helper" in sessions opened with "first, second, third", in that order
      When Ada sends "fourth" to "helper"
      Then Ada sees the sessions of "helper" listed as "fourth, third, second, first"
