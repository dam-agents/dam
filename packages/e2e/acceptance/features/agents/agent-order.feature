Feature: The order of an owner's agents
  An owner's agents are listed in one order the owner arranges.
  The platform keeps that order for the owner, the same in every browser.

  Rule: An owner's agents are listed oldest made first until the owner arranges them

    @ui
    Example: Ada's agents are listed in the order Ada made them
      Given Ada made the agents "alpha, beta", in that order
      And Ada has not arranged any agents
      When Ada looks at the agents
      Then Ada's agents are listed as "alpha, beta"

  Rule: An owner moves an agent to any place in the list

    @ui
    Example: Ada moves beta to the top
      Given Ada made the agents "alpha, beta", in that order
      And Ada has not arranged any agents
      When Ada moves "beta" before "alpha"
      Then Ada's agents are listed as "beta, alpha"

    @ui
    Example: Ada moves alpha to the foot
      Given Ada made the agents "alpha, beta", in that order
      And Ada has not arranged any agents
      When Ada moves "alpha" after "beta"
      Then Ada's agents are listed as "beta, alpha"

  Rule: The order an owner arranges follows the owner to every browser

    @ui
    Example: Ada finds the same order after signing in again
      Given Ada made the agents "alpha, beta", in that order
      And Ada has arranged the agents as "beta, alpha"
      When Ada signs in
      Then Ada's agents are listed as "beta, alpha"

  Rule: A new agent joins the foot of the list

    @ui
    Example: delta joins below the agents Ada arranged
      Given Ada made the agents "alpha, beta", in that order
      And Ada has arranged the agents as "beta, alpha"
      And Ada has since made an agent called "delta"
      When Ada looks at the agents
      Then Ada's agents are listed as "beta, alpha, delta"

  Rule: Neither opening an agent nor its activity moves it

    @ui
    Example: An answer from beta leaves it where Ada put it
      Given Ada made the agents "alpha, beta", in that order
      And Ada has arranged the agents as "alpha, beta"
      When Ada sends "hello" to "beta"
      Then Ada's agents are listed as "alpha, beta"

    @ui
    Example: Opening the sessions of beta leaves it where Ada put it
      Given Ada made the agents "alpha, beta", in that order
      And Ada has arranged the agents as "alpha, beta"
      When Ada opens the sessions of "beta"
      Then Ada's agents are listed as "alpha, beta"

  Rule: Deleting an agent drops it from the owner's order

    Example: scratch leaves Ada's order when Ada deletes it
      Given Ada has a running agent called "alpha"
      And Ada has an agent called "scratch"
      And Ada has arranged the agents as "scratch, alpha"
      When Ada deletes "scratch"
      Then Ada's order of agents no longer names "scratch"
