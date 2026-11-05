# An opted-in user meets their assistant

## AC-1 — the assistant's first chat opens on its greeting

Given the QA install in its default `experimental` mode, and an account that has turned the assistant on under Settings → Experimental features but never used it
When the owner signs in and lands in the assistant's chat
Then the chat opens with a message from the assistant, its avatar and name above it, reading *Hi <the owner's first name>!
I'm Dambledore, your new personal DAM agent!*
And below that message stands *The more I know about you, the more I can help.
Tell me a bit about your role and what you're working on, and I'll make some suggestions!*
And under the message sit the first tasks *Explain what you can do*, *Draft a weekly status template*, *Summarize a long text I paste* and *Remember I like answers short and technical*
And the empty message box hints *Remember I like answers short and technical*

## AC-2 — a first task fills the message box and sends nothing

Given that greeting
When the owner clicks *Explain what you can do*
Then the message box holds that text, and nothing was sent
And the greeting is still on screen

## AC-3 — the assistant answers the greeting as a greeting

Given that greeting, its clicked task in the message box, and a model connection granted to the assistant
When the owner sends it
Then the assistant replies with what it can do
And, since it does not know them yet, it asks about their role or what they are working on
And the conversation is listed in the sidebar

## AC-4 — the greeting does not come back

Given that conversation
When the owner clicks *New chat*
Then the chat opens on the ordinary new-chat page, with the agent's large avatar and *Send a message to begin.*
And the message box hints *Message…*
And no greeting and no first tasks are shown

## AC-5 — an account that never opts in sees nothing of it

Given the same install, and an account that has not turned the assistant on
When the owner signs in
Then no greeting, no first tasks and no assistant agent appear
And the message box of any agent they open hints *Message…* as it always did
