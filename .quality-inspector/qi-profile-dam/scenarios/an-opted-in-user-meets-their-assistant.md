# An opted-in user meets their assistant

## AC-1 — the switch offers the assistant by name

Given a fresh platform and the owner signed in, with Settings → Experimental features open
When they look at the rows
Then the second-to-last row is labelled *DAM connection* and described as *Let your agents act as you on DAM through a connection.
Turning this off leaves the connections you already made working.*
And the last row is labelled *Dammy* and described as *Smart assistant that can control DAM for you*
When they switch the assistant's row on and open their agent list
Then Dammy is there as an ordinary agent, with its own avatar
And it holds the *DAM connection*, which its Connections page lists as *Acts as you on DAM*

## AC-1b — the connection's own switch offers it to the account's agents

Given that account with Settings → Experimental features open
When they switch *DAM connection* on and open an agent's Connections page
Then *Add connection* offers *DAM connection*, whose pane has no field to fill and one button, *Create connection*
When they click it
Then the agent's Connections page lists *DAM connection*, flagged *Acts as you on DAM*, and the API keys settings show a key named *DAM connection*
When they switch *DAM connection* off again and reload that page
Then the connection and its grant are still there, and *Remove from this agent* and *Rotate key* still work
And a second grant offers the connection to no other agent: *Add connection* no longer offers *DAM connection*

## AC-2 — the assistant's first chat opens on its greeting

Given that account, whose assistant has never been used
When the owner signs in again
Then they land in Dammy's chat rather than on Home
And the chat opens with a message from the assistant, its avatar and name above it, reading *Hi <the owner's first name>!
I'm Dammy, your personal DAM agent.
You're set up with CurveBender, IBM-hosted open-source models.
You can change that in Agent settings.*, with *Agent settings* a link
And below that message stands *I learn how you work, one task at a time.
Pick one to try, or ask me anything.*
And under the message sit five pills, each labelled in bold: *Artifact:* Make my next PowerPoint deck the way I make them, *Schedule:* Do competitive research over night, the way I do it, *Knowledge base:* Learn my project so I can ask questions, *Skill:* Learn how my team writes tickets, then take it over, and *DAM:* Ask me a question about DAM
And the avatar-unlock celebration plays beside the composer, reading *You unlocked your first agent avatar!*
It's now your new agent's avatar.
Finish the checklist to unlock more.\*, with a *Nice* button

## AC-3 — a pill fills the message box and sends nothing

Given that greeting
When the owner clicks the *Artifact:* pill
Then the message box holds *Artifact: Make my next PowerPoint deck the way I make them*, and nothing was sent
And the greeting is still on screen

## AC-4 — the greeting does not come back once the assistant was used

Given that greeting, with its text in the message box
When the owner sends it and the assistant replies
Then the conversation is listed in the sidebar
When they open a new chat on Dammy
Then the chat opens on the ordinary new-chat page, with the agent's large avatar and *Send a message to begin.*
And the message box hints *Message…*
And no greeting and no first tasks are shown

## AC-5 — the assistant is an ordinary agent

Given Dammy in the owner's list
When the owner opens its Manage section
Then Disable and Delete are offered as they are on any other agent, and its name can be edited from its identity
When they rename it and open Settings → Experimental features
Then the *Onboarding progress* card at the bottom of the tab still offers its reset, and the tab offers no second one under the assistant's row

## AC-6 — the Onboarding progress card takes the account back to a first open

Given that account with the assistant used, and the Switch on
When the owner clicks *Reset onboarding progress* on the *Onboarding progress* card at the bottom of Experimental features
Then one confirm asks first, saying that every avatar locks again, that agents keep theirs and that nothing in the account is deleted
When they confirm
Then the app goes to its entry route and lands them in Dammy's chat, which opens on the greeting again
And the avatar-unlock celebration plays beside the composer again, as it did at the first open
When they click its *Nice*, and only then
Then the Get started checklist counts one task of eight — Create your first agent — as done, its avatar unlocked and seen
And the assistant's earlier conversations are still in the sidebar

## AC-7 — the same card gives Dammy back when the account has none

Given that account, whose Dammy the owner has deleted
When they confirm the *Onboarding progress* card's reset
Then a new agent named Dammy is in their agent list, unused, and its chat opens on the greeting

## AC-8 — the same card reuses the agent the platform made, renamed or not

Given that account, where the owner renamed Dammy to *Research helper* and used it
When they confirm the *Onboarding progress* card's reset
Then no new agent is made, and the account lands in *Research helper*, which opens on the greeting
When instead they rename it away and make an agent of their own called *Dammy*, then confirm the card's reset
Then no new agent is made either, and the account does not land in the one they made: it is theirs, not the assistant's

## AC-9 — a new account meets Dammy without opting in

Given the same install, and an account that has never opened Experimental features
When the owner signs in for the first time
Then Dammy is already in their agent list and their first landing is its chat, which opens on the greeting
And the celebration beside the composer plays before they have switched anything on
And Experimental features shows the assistant's row already on
And opting it out is the switch AC-10 describes

## AC-10 — turning the switch off deletes nothing

Given that account with the assistant switched on and used
When they switch the assistant's row off
Then no confirm appears, and Dammy is still in their agent list with its conversations
And no greeting and no landing are shown until they switch it back on
And the *Onboarding progress* card's reset still restarts the checklist, leaving Dammy and its use where they are

## AC-11 — the switch makes one only when the name is free, and keeps the one it made

Given an account with no agent under the assistant's name, and Settings → Experimental features open
When the owner switches the assistant's row on
Then Dammy appears in their agent list
When they switch it off, delete Dammy, and switch it on again
Then a new Dammy appears, unused
When instead they rename Dammy to *Research helper* and switch the row off and on again
Then no new agent appears: *Research helper* is still the assistant
And its chat greets them for as long as it has never been used
And no agent is ever named *Dammy 2*

## AC-12 — an agent the owner made under the name is never the assistant

Given an account that made an agent of their own called *Dammy* before turning the feature on
When they switch the assistant's row on
Then no second agent appears for that name, and their own Dammy opens on the ordinary new-chat page with no greeting
And their next sign-in lands on Home rather than in that chat
When they delete or rename their own Dammy and switch the row off and on again
Then the platform's Dammy appears, unused, and greets them
