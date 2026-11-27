Feature: An agent's egress rules
  Every request an agent makes leaves through its gateway.
  The agent's egress rules let a request through or refuse it, and a request no rule covers waits for the owner's verdict.

  Rule: An owner writes a rule for an agent by hand

    @ui
    Example: Ada lets helper read the status pages of postman-echo
      Given Ada has a running agent called "helper"
      When Ada allows "GET" requests to "postman-echo.com/status/*" for "helper"
      Then Ada sees "helper" allowed "GET" requests to "postman-echo.com/status/*"

  Rule: A request a rule allows passes without asking the owner

    Example: helper reaches a status page Ada allowed
      Given Ada has a running agent called "helper"
      And Ada has allowed "GET" requests to "postman-echo.com/status/*" for "helper"
      When Ada asks "helper" to call "https://postman-echo.com/status/204"
      Then Ada sees that "helper" got status 204
      And Ada sees no waiting network approval of "helper"

  Rule: A rule narrowed to a path covers no other path of its host

    Example: helper's request for headers waits for Ada
      Given Ada has a running agent called "helper"
      And Ada has allowed "GET" requests to "postman-echo.com/status/*" for "helper"
      When Ada asks "helper" to call "https://postman-echo.com/headers"
      Then Ada sees a waiting network approval of "helper" for "GET postman-echo.com/headers"

  Rule: A request no rule covers waits for the owner's verdict

    @ui
    Example: helper's request for its address waits for Ada
      Given Ada has a running agent called "helper"
      And Ada has allowed "GET" requests to "postman-echo.com/status/*" for "helper"
      When Ada asks "helper" to call "https://postman-echo.com/ip"
      Then Ada sees a waiting network approval of "helper" for "GET postman-echo.com/ip"

  Rule: Allowing a request once lets it through and writes no rule

    @ui
    Example: helper gets its address once
      Given Ada has a running agent called "helper"
      And Ada has allowed "GET" requests to "postman-echo.com/status/*" for "helper"
      And "helper" is waiting for Ada's verdict on "GET https://postman-echo.com/ip"
      When Ada allows that request once
      Then the waiting request of "helper" gets status 200
      And Ada sees no rule of "helper" for "GET postman-echo.com/ip"

  Rule: Always allowing a request writes a rule for its method and path only

    @ui
    Example: Ada always allows helper's request for /get
      Given Ada has a running agent called "helper"
      And Ada has allowed "GET" requests to "postman-echo.com/status/*" for "helper"
      And "helper" is waiting for Ada's verdict on "GET https://postman-echo.com/get"
      When Ada always allows that request
      Then Ada sees "helper" allowed "GET" requests to "postman-echo.com/get"
      And Ada sees no rule of "helper" for all of "postman-echo.com"

  Rule: Identical requests join one waiting approval, and one verdict answers them all

    Example: one verdict lets both of helper's identical requests through
      Given Ada has a running agent called "helper"
      And Ada has allowed "GET" requests to "postman-echo.com/status/*" for "helper"
      And "helper" has requested "https://postman-echo.com/ip" twice, waiting for Ada's verdict
      When Ada allows that request once
      Then both requests of "helper" get status 200
      And Ada sees no waiting network approval of "helper"

  Rule: A request a deny rule refuses is answered with the rule that refused it

    Example: helper is told which rule blocked its request for headers
      Given Ada has a running agent called "helper"
      And Ada has denied "GET" requests to "postman-echo.com/headers" for "helper"
      When Ada asks "helper" to call "https://postman-echo.com/headers"
      Then Ada sees that "helper" got status 403
      And Ada sees that "helper" was refused by the rule denying "GET" requests to "postman-echo.com/headers"

  Rule: With network approvals in the chat, the agent's chat shows its waiting network approvals

    @ui
    Example: Ada sees helper's waiting request in a chat opened after it
      Given Ada has network approvals in the chat turned on
      And Ada has a running agent called "helper"
      And Ada has allowed "GET" requests to "postman-echo.com/status/*" for "helper"
      And "helper" is waiting for Ada's verdict on "GET https://postman-echo.com/ip"
      When Ada opens the chat with "helper"
      Then Ada sees in the chat that "helper" waits for "GET postman-echo.com/ip"

    @ui
    Example: Ada's verdict in the chat lets the waiting request through
      Given Ada has network approvals in the chat turned on
      And Ada has a running agent called "helper"
      And Ada has allowed "GET" requests to "postman-echo.com/status/*" for "helper"
      And "helper" is waiting for Ada's verdict on "GET https://postman-echo.com/ip"
      When Ada allows that request once in the chat with "helper"
      Then the waiting request of "helper" gets status 200
      And Ada sees no waiting network approval of "helper"
