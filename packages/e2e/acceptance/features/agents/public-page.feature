@todo
Feature: The public agent page
  Anyone who opens the link under an agent's post sees its public page, without signing in.
  The page names an agent only when the agent is bound to a channel, and invites the reader to make an agent of their own.

  Rule: An agent bound to a channel is named on its public page, together with its owner
  Rule: An agent bound to no channel reads on its public page like one that does not exist
  Rule: The public page names the owner by their display name, never their email, and not at all when they have none
  Rule: A signed-in person who cannot open an agent is shown its public page
  Rule: An agent whose channels are all released is no longer named on its public page
