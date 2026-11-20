@journey @ui
Feature: First use
  A new owner meets a first agent, gets an answer, and tidies up.

  # @wip: the agent made in one click from the Generalist card gets no grant
  # of the owner's model provider, which agents made through the API get,
  # so its chat takes no message (found by this journey on #6740).
  @wip
  Scenario: Jo meets a first agent
    Given Jo has a model provider connected
    When Jo signs in
    And Jo makes an agent from the Generalist starter kit, known here as "first"
    Then Jo sees an agent called "first"
    When Jo sends "hello" to "first"
    Then Jo sees "first" answer
    When Jo deletes "first"
    Then Jo does not see an agent called "first"
