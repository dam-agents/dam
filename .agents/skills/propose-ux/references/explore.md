# Explore the problem

Goal: know who has the problem, what they do today, and how much it costs them, before any solution exists.
The output is the brief.
Show the brief and stop.

## Sources of evidence

The agent cannot talk to users, so it reads what already records them.

| Source                                                                  | What it gives                                                                                                                                                                            |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The issue, linked issues and pull requests, and the history of the area | Who asked, why, and whether today's behavior was a deliberate decision                                                                                                                   |
| The architecture page of the subsystem, and the glossary                | What the thing is, and the words users read                                                                                                                                              |
| The running app                                                         | The current flow as the person meets it: each step, each state, each dead end                                                                                                            |
| Usage analytics (`docs/architecture/usage-tracking.md`)                 | How new people get through their first weeks, and which features they use. Only the `platform-inspector` role can read it, so ask the user for a read and never read production yourself |
| Other tools that do the same job                                        | How people solve the job elsewhere. Compare the job, not the whole product                                                                                                               |
| The user                                                                | What the user holds: messages, call notes, screenshots, and what they saw people do                                                                                                      |

Walk the current flow in the running app as the person.
Use the `cluster-ops` skill to bring the app up.
A flow for a new person needs a fresh account.
A flow for many items needs seeded data.
A channel flow needs the channel set up.
Keep a screenshot of each step, because the proposal needs the "before".
When the app cannot run where you are, read the code path instead, and say so and why.

## Steps

1. **Find the person and the moment.**
   Name who it is.
   It can be the owner of an agent, or someone that a thing is shared with.
   It can be a member of a Slack or Telegram conversation bound to an agent, or a visitor who opens a public link.
   It can be a Platform Operator.
   Name what happened just before they need this.
2. **State the job.**
   Write one statement per job: *When \[situation\], I want to \[motivation\], so I can \[outcome\].*
   Two jobs are two pieces of work.
   Say so, and take the main one first.
3. **Map the path today.**
   List each step the person takes now, including workarounds outside DAM.
   Mark each place where the person waits, guesses, leaves or asks someone.
   These places are the opportunities.
4. **Label the evidence.**
   - *Observed*: you saw it in the product, the code, an architecture page or data.
     Cite the source.
   - *Reported*: someone says it, in an issue, a message or call notes.
     Name who.
   - *Inferred*: you reasoned it from observed or reported facts.
     Show the reasoning.
   - *Assumed*: nothing backs it.
5. **Ask for what is missing.**
   Ask the user only what the evidence cannot answer.
   Start with the assumptions that the design would depend on.
   Ask one question at a time, with your recommended answer, as `grill-me` does.
6. **Write the brief.**

## The brief

- **Problem**: what happens, to whom, and with what consequence.
  No solution in this line.
- **Job**: the statements from step 2.
- **Path today**: the steps from step 3, with the pain points marked.
  Say how you learned them: screenshots, the code path, or why neither was possible.
- **Success criteria**: outcomes that a person can observe, each able to fail a concept.
  Mark each as a *threshold* (a concept that fails it is out) or a *trade-off* (weighed against the others).
  Add the design rules in `PROFILE.md` and mark them too.
- **Existing designs**: the proposed solution, prototype or criteria that the issue already holds, and whether the criteria are binding.
- **Constraints**: the surfaces, and the limits that the architecture pages state.
- **Out of scope**: what this proposal does not touch.
- **Evidence**: a table of claim, label and source.
- **Added by the exploration**: the facts and sources that the issue does not hold.
- **Open questions**: the assumptions that remain, and who can answer each one.

### Criteria that can fail

| Weak           | Strong                                                           |
| -------------- | ---------------------------------------------------------------- |
| "Feels modern" | "Uses only components that exist today"                          |
| "Feels simple" | "A new person sends a first message after three choices at most" |
| "Scales"       | "Shows 400 agents without paging"                                |

## The exploration is not done when

- A solution hides in the problem statement.
- No success criterion can fail a concept.
- The brief adds nothing that the issue did not already say.
- Most facts are only *reported* or *assumed*.
- A persona has a name, an age and a quote.
