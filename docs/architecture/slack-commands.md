# Slack commands

Last verified: 2026-11-13

How a person runs the in-chat Slack commands without typing them: the menu the bare slash command opens.
What each command does and who may run it lives on [channels](channels.md), and which outcomes are guaranteed on [slack-guarantees](slack-guarantees.md).

## The command menu

`/platform` with no text answers with an ephemeral message, so the person stays in the conversation and nobody else sees it.
It lists the conversation's Agents, the default first, each with the mention that reaches it, its owner and its role.
Under each Agent sit Whisper, which opens the private thread, Make default where it is not the default, and a "more" control with ambient, channel history, whispers, deleting a post and disconnect.
The last row adds an Agent, closes the menu, and holds the ignored apps, all commands and log in or out under its own "more" control.
A control carries the text of the command it stands for and runs through the same handler as the typed command, so both do the same thing under the same authorization.
The command's reply then takes the menu's place, so the menu is gone once an action is done.
Disconnect first swaps the menu for a confirmation, and the ignored apps for their own list, each with a way back.
The one-message whisper has no control, as it needs a text field; it stays `/platform whisper <agent> "message"`.
Slack has no disabled control, so an action the person may not take is left out; the command still checks again when a control runs.
The command is acknowledged at once and the menu follows through the command's response URL, so slow lookups never run into the three seconds Slack gives a slash command.
A click changes the menu through the response URL Slack sends with it, the only way to change an ephemeral message, and only a click in an ephemeral message runs a command.
A "more" control holds five items and a message 50 blocks, so the menu lists ten Agents and ten ignored apps and points at `/platform who` and `/platform ignore` for the rest.
`/platform help` and any unknown word show the usage line.
Ignoring an app and deleting a post take a message link, so they stay typed commands, and the menu says how to run them.
