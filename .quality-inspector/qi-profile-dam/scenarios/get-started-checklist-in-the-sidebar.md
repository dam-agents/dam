# The Get started checklist in the sidebar

## AC-1 — Get started sits in the sidebar footer

Given a fresh platform and the owner signed in
When they look at the sidebar
Then Get started sits above Documentation and Settings, with a ring that shows how many of the eight tasks are done

## AC-2 — a click opens the checklist beside the sidebar, and the close button shuts it

Given the Get started item
When the owner clicks it
Then a popover opens beside the item with the done count, a strip of eight slots and the eight tasks
When they click its close button
Then the popover closes back to the item, which stays in the footer

## AC-3 — a task row takes the user where the task is done, and closes the checklist

Given the open checklist
When the owner clicks the row Create a connection
Then Settings → Connections opens and the checklist is closed

## AC-4 — the mark beside a task explains it on a click, a tap and a keyboard focus

Given the open checklist
When the owner clicks, taps, or reaches with the Tab key, the ⓘ beside Schedule a recurring task
Then a small card shows one line about that task, and the task itself is not started

## AC-5 — Dismiss hides the checklist until the next unlock

Given the open checklist
When the owner clicks Dismiss
Then Get started leaves the sidebar footer
When they finish another checklist task elsewhere
Then the item comes back, counting the unlock they have not seen

## AC-6 — an unseen unlock carries a count, and the checklist celebrates it once

Given an unlock the owner has not seen, counted on the Get started item
When they open the checklist
Then the popover shows the celebration for that character in place of the task list
When they click Nice
Then the task list comes back with the character in its slot, and the count is gone

## AC-7 — a collapsed sidebar keeps the ring alone

Given the sidebar collapsed with the chevron in its header
When the owner looks at the footer
Then Get started shows as the ring alone, and a screen reader reads its progress

## AC-8 — on a phone the checklist opens inside the navigation drawer

Given a narrow window with the navigation drawer closed
When the owner opens the avatar picker and clicks See how to unlock the rest
Then the navigation drawer opens with the checklist open beside its Get started item
When they close the drawer
Then reopening it shows Get started closed
