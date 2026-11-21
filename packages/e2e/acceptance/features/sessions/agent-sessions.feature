Feature: An agent's sessions
  Each conversation with an agent is a session of its own.
  An owner finds an agent's sessions listed by their titles, and deletes the ones they no longer need.

  Rule: A new session is listed with its first message as its title

    @ui
    Example: Ada's question to helper becomes a session
      Given Ada has a running agent called "helper" that answers "noted"
      When Ada sends "plan the trip" to "helper"
      Then Ada sees a session of "helper" called "plan the trip"

  Rule: A deleted session is no longer listed

    @ui
    Example: Ada deletes the trip session
      Given Ada has a running agent called "helper" that answers "noted"
      And Ada has talked to "helper" about "plan the trip"
      When Ada deletes the session "plan the trip" of "helper"
      Then Ada does not see a session of "helper" called "plan the trip"

  Rule: Deleting a session leaves the session a person has open as it is

    @ui
    Example: Ada deletes the trip session while talking to helper in another
      Given Ada has a running agent called "helper" that answers "noted"
      And Ada has talked to "helper" about "plan the trip"
      And Ada has an answer from "helper" to "pack the bags" in the chat
      When Ada deletes the session "plan the trip" of "helper"
      Then Ada still has the session "pack the bags" of "helper" open
