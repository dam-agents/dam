Feature: An agent's connections
  An owner grants connections to agents.
  An agent reaches a service only through a connection it holds.

  Rule: A connection an owner makes for an agent is granted to that agent

    @ui
    Example: Ada makes the weather connection for helper
      Given Ada has a running agent called "helper"
      When Ada makes a connection called "weather" to "api.weather.test" for "helper"
      Then "helper" holds the connection "weather"

  Rule: Removing a connection takes it from every agent holding it

    Example: Ada removes the weather connection helper holds
      Given Ada has a running agent called "helper"
      And Ada has a connection called "weather" to "api.weather.test"
      And Ada has granted "weather" to "helper"
      When Ada removes the connection "weather"
      Then "helper" does not hold the connection "weather"

  Rule: Replacing a connection's secret keeps it with the agents holding it

    Example: helper keeps the weather connection after Ada replaces its secret
      Given Ada has a running agent called "helper"
      And Ada has a connection called "weather" to "api.weather.test"
      And Ada has granted "weather" to "helper"
      When Ada replaces the secret of "weather"
      Then "helper" holds the connection "weather"

  Rule: An agent holds two connections to one service only when it can name each of them

    Example: helper cannot take a second weather key that sets no variable
      Given Ada has a running agent called "helper"
      And Ada has a connection called "weather" to "api.weather.test" that sets no variable
      And Ada has granted "weather" to "helper"
      And Ada has a connection called "weather-backup" to "api.weather.test" that sets no variable
      When Ada grants "weather-backup" to "helper"
      Then Ada is told "helper" can use only one of them

    Example: helper takes a second weather key that sets a variable of its own
      Given Ada has a running agent called "helper"
      And Ada has a connection called "weather" to "api.weather.test"
      And Ada has granted "weather" to "helper"
      And Ada has a connection called "weather-backup" to "api.weather.test"
      When Ada grants "weather-backup" to "helper"
      Then "helper" holds the connection "weather-backup"
