# An opted-in user meets their assistant

## AC-1 — the switch offers the assistant by name

Given a fresh platform and the owner signed in, with Settings → Experimental features open
When they look at the rows
Then the last row is labelled *Dambledore* and described as *Smart assistant that can control DAM for you*
When they switch it on and open their agent list
Then Dambledore is there as an ordinary agent, with its own avatar

## AC-2 — the assistant's first chat opens on its greeting

Given that account, whose assistant has never been used
When the owner signs in again
Then they land in Dambledore's chat rather than on Home
And the chat opens with a message from the assistant, its avatar and name above it, reading *Hi <the owner's first name>!
I'm Dambledore, your new personal DAM agent!*
And below that message stands *The more I know about you, the more I can help.
Tell me a bit about your role and what you're working on, and I'll make some suggestions!*
And under the message sit the first tasks *Explain what you can do*, *Draft a weekly status template*, *Summarize a long text I paste* and *Remember I like answers short and technical*
And the empty message box hints *Remember I like answers short and technical*

## AC-3 — a first task fills the message box and sends nothing

Given that greeting
When the owner clicks *Explain what you can do*
Then the message box holds that text, and nothing was sent
And the greeting is still on screen

## AC-4 — the greeting does not come back once the assistant was used

Given that greeting, with its text in the message box
When the owner sends it and the assistant replies
Then the conversation is listed in the sidebar
When they open a new chat on Dambledore
Then the chat opens on the ordinary new-chat page, with the agent's large avatar and *Send a message to begin.*
And the empty message box shows example prompts one after another, each with a *Tab* hint, in place of a first task
And no greeting and no first tasks are shown

## AC-5 — the assistant is an ordinary agent

Given Dambledore in the owner's list
When the owner opens its Manage section
Then Disable and Delete are offered as they are on any other agent, and its name can be edited from its identity
When they rename it and open Settings → Experimental features
Then the *Onboarding progress* card at the bottom of the tab still offers its reset, and the tab offers no second one under the assistant's row

## AC-6 — the Onboarding progress card takes the account back to a first open

Given that account with the assistant used, and the Switch on
When the owner clicks *Reset onboarding progress* on the *Onboarding progress* card at the bottom of Experimental features
Then one confirm asks first, saying that every avatar locks again, that agents keep theirs and that nothing in the account is deleted
When they confirm
Then the app goes to its entry route and lands them in Dambledore's chat, which opens on the greeting again
And the Get started checklist counts one task of eight — Create your first agent — as done, its avatar unlocked and seen
And the assistant's earlier conversations are still in the sidebar

## AC-7 — the same card gives Dambledore back when the account has none

Given that account, whose Dambledore the owner has deleted
When they confirm the *Onboarding progress* card's reset
Then a new agent named Dambledore is in their agent list, unused, and its chat opens on the greeting

## AC-8 — the same card reuses the agent the platform made, renamed or not

Given that account, where the owner renamed Dambledore to *Research helper* and used it
When they confirm the *Onboarding progress* card's reset
Then no new agent is made, and the account lands in *Research helper*, which opens on the greeting
When instead they rename it away and make an agent of their own called *Dambledore*, then confirm the card's reset
Then no new agent is made either, and the account does not land in the one they made: it is theirs, not the assistant's

## AC-9 — an account that never opts in sees nothing of it

Given the same install, and an account that has not turned the assistant on
When the owner signs in
Then no greeting, no first tasks and no assistant agent appear
And they land on Home as usual
And a new chat on any agent they open shows the example prompts in its empty message box, never a first task

## AC-10 — turning the switch off deletes nothing

Given that account with the assistant switched on and used
When they switch the assistant's row off
Then no confirm appears, and Dambledore is still in their agent list with its conversations
And no greeting and no landing are shown until they switch it back on
And the *Onboarding progress* card's reset still restarts the checklist, leaving Dambledore and its use where they are

## AC-11 — the switch makes one only when the name is free, and keeps the one it made

Given an account with no agent under the assistant's name, and Settings → Experimental features open
When the owner switches the assistant's row on
Then Dambledore appears in their agent list
When they switch it off, delete Dambledore, and switch it on again
Then a new Dambledore appears, unused
When instead they rename Dambledore to *Research helper* and switch the row off and on again
Then no new agent appears: *Research helper* is still the assistant
And its chat greets them for as long as it has never been used
And no agent is ever named *Dambledore 2*

## AC-12 — an agent the owner made under the name is never the assistant

Given an account that made an agent of their own called *Dambledore* before turning the feature on
When they switch the assistant's row on
Then no second agent appears for that name, and their own Dambledore opens on the ordinary new-chat page with no greeting
And their next sign-in lands on Home rather than in that chat
When they delete or rename their own Dambledore and switch the row off and on again
Then the platform's Dambledore appears, unused, and greets them
