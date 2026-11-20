Feature: An agent's environment
  An owner sets environment variables for an agent.
  The agent reads them at its next turn, beside the ones its connections give it.

  Rule: A variable the owner sets reaches the agent at its next turn

    Example: helper reads the units Ada set
      Given Ada has a running agent called "helper"
      When Ada sets WEATHER_UNITS to "metric" for "helper"
      Then within two minutes "helper" reads WEATHER_UNITS as "metric"

    Example: helper reads the units Ada changed
      Given Ada has a running agent called "helper"
      And Ada has set WEATHER_UNITS to "metric" for "helper"
      When Ada sets WEATHER_UNITS to "imperial" for "helper"
      Then within two minutes "helper" reads WEATHER_UNITS as "imperial"

  Rule: The owner sees the variables they set

    @ui
    Example: Ada sees the units Ada set for helper
      Given Ada has a running agent called "helper"
      When Ada sets WEATHER_UNITS to "metric" for "helper"
      Then Ada sees WEATHER_UNITS set to "metric" in the environment of "helper"

  Rule: A variable the owner sets wins over a connection's variable of the same name

    Example: Ada's own ECHO_KEY shadows the one the echo connection gives helper
      Given Ada has a running agent called "helper"
      And Ada has a connection called "echo" to "httpbingo.org" with the key "s3cret-ada" in ECHO_KEY
      And Ada has granted "echo" to "helper"
      When Ada sets ECHO_KEY to "my-own-key" for "helper"
      Then within two minutes "helper" reads ECHO_KEY as "my-own-key"

    Example: helper reads the echo connection's placeholder again once Ada removes Ada's own ECHO_KEY
      Given Ada has a running agent called "helper"
      And Ada has a connection called "echo" to "httpbingo.org" with the key "s3cret-ada" in ECHO_KEY
      And Ada has granted "echo" to "helper"
      And Ada has set ECHO_KEY to "my-own-key" for "helper"
      When Ada removes ECHO_KEY from "helper"
      Then within two minutes "helper" reads ECHO_KEY as the placeholder of "echo"
