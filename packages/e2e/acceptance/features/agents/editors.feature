@todo
Feature: An agent's editors
  An owner names editors who work on an agent with them.
  The agent keeps its one owner, and runs on the owner's budget and connections.

  Rule: An agent an owner shares is listed for each of its editors, naming its owner
  Rule: An editor changes an agent's set-up and works in its sessions as its owner does
  Rule: Only the owner changes an agent's connections, channels or editors, or deletes it
  Rule: An editor reaches a shared agent only in the web app, never with the CLI or an API key
  Rule: An editor the owner removes loses the agent at once, even while it is open
