Feature: Credentials a connection injects
  A connection's credential never enters the agent.
  The agent holds a placeholder, and its gateway puts the real credential on the requests to the connection's host.

  Rule: An agent holds a placeholder for a connection's credential, never the credential

    Example: helper holds a placeholder for the echo key
      Given Ada has a running agent called "helper"
      And Ada has a connection called "echo" to "httpbingo.org" with the key "s3cret-ada" in ECHO_KEY
      When Ada grants "echo" to "helper"
      Then within two minutes "helper" reads ECHO_KEY as the placeholder of "echo"

  Rule: The gateway puts the real credential on a request that names the connection

    Example: httpbingo receives the echo key from helper
      Given Ada has a running agent called "helper"
      And Ada has a connection called "echo" to "httpbingo.org" with the key "s3cret-ada" in ECHO_KEY
      And Ada has granted "echo" to "helper"
      When Ada asks "helper" to call "https://httpbingo.org/headers" with its ECHO_KEY
      Then Ada sees "helper" answer "s3cret-ada"

  Rule: An agent that requires naming gets a credential only on a request that names its connection

    Example: helper's request naming no connection reaches httpbingo without the echo key
      Given Ada has a running agent called "helper" that requires naming its connections
      And Ada has a connection called "echo" to "httpbingo.org" with the key "s3cret-ada" in ECHO_KEY
      And Ada has granted "echo" to "helper"
      When Ada asks "helper" to call "https://httpbingo.org/headers"
      Then Ada sees that "helper" got status 200
      And Ada sees "helper" answer without "s3cret-ada"

  Rule: An agent that does not require naming gets the credential on every request to the connection's host

    Example: helper's request naming no connection still carries the echo key
      Given Ada has a running agent called "helper" that does not require naming its connections
      And Ada has a connection called "echo" to "httpbingo.org" with the key "s3cret-ada" in ECHO_KEY
      And Ada has granted "echo" to "helper"
      When Ada asks "helper" to call "https://httpbingo.org/headers"
      Then Ada sees "helper" answer "s3cret-ada"

  Rule: A connection's credential goes only to the connection's own host

    Example: postman-echo receives helper's placeholder, not the echo key
      Given Ada has a running agent called "helper"
      And Ada has a connection called "echo" to "httpbingo.org" with the key "s3cret-ada" in ECHO_KEY
      And Ada has granted "echo" to "helper"
      And Ada has allowed all requests to "postman-echo.com" for "helper"
      When Ada asks "helper" to call "https://postman-echo.com/headers" with its ECHO_KEY
      Then Ada sees "helper" answer without "s3cret-ada"
      And Ada sees "helper" answer the placeholder of "echo"

  Rule: A replaced credential reaches the connection's host without a restart

    Example: httpbingo receives the new echo key
      Given Ada has a running agent called "helper"
      And Ada has a connection called "echo" to "httpbingo.org" with the key "s3cret-old" in ECHO_KEY
      And Ada has granted "echo" to "helper"
      When Ada replaces the key of "echo" with "s3cret-new"
      Then within two minutes the calls of "helper" to "https://httpbingo.org/headers" with its ECHO_KEY carry "s3cret-new"
