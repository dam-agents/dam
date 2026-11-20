Feature: An owner's connections
  A connection holds what an agent needs to reach one external service.
  It belongs to the person who made it.

  Rule: An owner's connections are listed for that owner only

    @ui
    Example: Ada sees the connection Ada made
      Given Ada has a connection called "weather" to "api.weather.test"
      When Ada looks at the connections
      Then Ada sees a connection called "weather"

    Example: Ben does not see Ada's connection
      Given Ada has a connection called "weather" to "api.weather.test"
      And Ben has a connection called "news" to "api.news.test"
      When Ben looks at the connections
      Then Ben sees a connection called "news"
      And Ben does not see a connection called "weather"
