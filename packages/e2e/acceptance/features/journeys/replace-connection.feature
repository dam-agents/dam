@journey @ui
Feature: Replacing a connection
  An owner replaces an agent's connection with a new one to the same service.

  Scenario: Ada replaces the weather connection of helper
    Given Ada has a running agent called "helper"
    And Ada has a connection called "weather" to "api.weather.test"
    And Ada has granted "weather" to "helper"
    When Ada removes the connection "weather"
    And Ada makes a connection called "weather-2" to "api.weather.test" for "helper"
    Then "helper" holds the connection "weather-2"
