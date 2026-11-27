Feature: Satellites
  A satellite is an MCP server on a machine outside the platform, which the machine reaches by polling.
  Its owner grants it to agents, and their calls of its tools become jobs on the machine.

  Rule: A connected satellite is listed for its owner with whether it is online, its host and its tools

    @ui
    Example: Ada sees the build farm Ada's machine connected
      Given Ada's machine "build-01" has connected the satellite "build-farm" offering "run"
      When Ada looks at the satellites
      Then Ada sees the satellite "build-farm" online on "build-01" offering "run"

  Rule: Nothing about satellites shows before one has connected

    @ui
    Example: Ada has no satellite to see
      Given Ada has connected no satellite
      When Ada looks at the satellites
      Then Ada sees no satellites

  Rule: An owner's satellites are the owner's alone

    Example: Ben does not see Ada's build farm
      Given Ada's machine "build-01" has connected the satellite "build-farm" offering "run"
      And Ben's machine "lab-01" has connected the satellite "lab" offering "run"
      When Ben looks at the satellites
      Then Ben sees the satellite "lab" online on "lab-01" offering "run"
      And Ben does not see a satellite called "build-farm"

    Example: Ben cannot grant Ada's build farm
      Given Ada's machine "build-01" has connected the satellite "build-farm" offering "run"
      And Ben has a running agent called "notes"
      When Ben grants the satellite "build-farm" to "notes"
      Then Ben is told there is no satellite called "build-farm"

  Rule: An owner grants a satellite to an agent, and can take it back

    @ui
    Example: Ada adds the build farm to helper
      Given Ada's machine "build-01" has connected the satellite "build-farm" offering "run"
      And Ada has a running agent called "helper"
      When Ada grants the satellite "build-farm" to "helper"
      Then Ada sees that "helper" holds the satellite "build-farm"

    Example: Ada takes the build farm back from helper
      Given Ada's machine "build-01" has connected the satellite "build-farm" offering "run"
      And Ada has a running agent called "helper"
      And Ada has granted the satellite "build-farm" to "helper"
      When Ada revokes the satellite "build-farm" from "helper"
      Then Ada sees that "helper" does not hold the satellite "build-farm"

  Rule: A call of a granted satellite's tool becomes a job on the machine

    Example: helper's build waits as a job on the build farm
      Given Ada's machine "build-01" has connected the satellite "build-farm" offering "run"
      And Ada has a running agent called "helper" that calls "run" on the satellite "build-farm"
      And Ada has granted the satellite "build-farm" to "helper"
      When Ada sends "build it" to "helper"
      Then Ada sees the job "build-farm#1" of "helper" queued

  Rule: An agent without a grant cannot reach a satellite

    Example: helper's call makes no job on a build farm it does not hold
      Given Ada's machine "build-01" has connected the satellite "build-farm" offering "run"
      And Ada has a running agent called "helper" that calls "run" on the satellite "build-farm"
      When Ada sends "build it" to "helper"
      Then Ada sees no job on "build-farm"

  Rule: A satellite that is shutting down takes no new work

    @ui
    Example: Ada sees the build farm shutting down
      Given Ada's machine "build-01" has connected the satellite "build-farm" offering "run"
      When Ada's machine "build-01" starts shutting down the satellite "build-farm"
      Then Ada sees the satellite "build-farm" shutting down

    Example: helper's build makes no job while the build farm shuts down
      Given Ada's machine "build-01" has connected the satellite "build-farm" offering "run"
      And Ada has a running agent called "helper" that calls "run" on the satellite "build-farm"
      And Ada has granted the satellite "build-farm" to "helper"
      And Ada's machine "build-01" has started shutting down the satellite "build-farm"
      When Ada sends "build it" to "helper"
      Then Ada sees no job on "build-farm"

  Rule: Taking a grant back cancels the agent's queued jobs

    Example: helper's waiting build is cancelled
      Given Ada's machine "build-01" has connected the satellite "build-farm" offering "run"
      And Ada has a running agent called "helper" that calls "run" on the satellite "build-farm"
      And Ada has granted the satellite "build-farm" to "helper"
      And "helper" has a job waiting on "build-farm"
      When Ada revokes the satellite "build-farm" from "helper"
      Then Ada sees the job "build-farm#1" of "helper" cancelled

  Rule: A machine that connects again keeps its satellite's grants

    Example: The build farm comes back with a new tool and keeps helper
      Given Ada's machine "build-01" has connected the satellite "build-farm" offering "run"
      And Ada has a running agent called "helper"
      And Ada has granted the satellite "build-farm" to "helper"
      When Ada's machine "build-01" connects the satellite "build-farm" again offering "run, test"
      Then Ada sees the satellite "build-farm" online on "build-01" offering "run, test"
      And Ada sees that "helper" holds the satellite "build-farm"

  Rule: A machine may not offer a tool named wait, get or cancel

    Example: The build farm offering a tool called wait is refused
      When Ada's machine "build-01" connects the satellite "build-farm" offering "wait"
      Then Ada's machine is told it may not offer a tool called "wait"
      And Ada does not see a satellite called "build-farm"

  Rule: An owner removes a satellite

    Example: Ada removes the build farm
      Given Ada's machine "build-01" has connected the satellite "build-farm" offering "run"
      When Ada removes the satellite "build-farm"
      Then Ada does not see a satellite called "build-farm"
