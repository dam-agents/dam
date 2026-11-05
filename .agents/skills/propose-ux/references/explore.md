# Explore the problem

Goal: know who has the problem, what they do today, and how much it costs them, before any solution exists.
Do this with the user.
The output is the brief.
Show the brief and stop.

## Move 1: do the homework

Read what already records the people and the problem.
Draft the person, the job and the path today from it.
Do not ask the user what a source already answers.

| Source                                                                  | What it gives                                                                                                         |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| The issue, linked issues and pull requests, and the history of the area | Who asked, why, and whether today's behavior was a deliberate decision                                                |
| The docs of the subsystem, and the glossary                             | What the thing is, and the words that users read                                                                      |
| The running product                                                     | The current flow as the person meets it: each step, each state, each dead end                                         |
| Usage data                                                              | How people use the product today. If you cannot reach it, ask the user for a read, and never read production yourself |
| Other products that do the same job                                     | How people solve the job elsewhere. Compare the job, not the whole product                                            |

Walk the current flow in the running product as the person.
Start it the way the project documents.
A flow for a new person needs a fresh account.
A flow for many items needs seeded data.
Keep a screenshot of each step, because the proposal needs the "before".
When the product cannot run where you are, read the code path instead, and say so and why.

## Label the evidence

- *Observed*: you saw it in the product, the code, the docs or data.
  Cite the source.
- *Reported*: someone says it, in an issue, a message, call notes or this conversation.
  Name who.
- *Inferred*: you reasoned it from observed or reported facts.
  Show the reasoning.
- *Assumed*: nothing backs it.

## Move 2: interview the user

The user knows what no source holds: what they saw people do, what messages and calls said, and what they want.
Ask one question at a time, with your recommended answer.
Walk your draft in this order, and let the user confirm or correct each part:

1. **The person and the moment.**
   Name who it is.
   It can be the owner of the thing, or someone that it is shared with.
   It can be a visitor with no account, or an admin or operator.
   Name what happened just before they need this.
2. **The job.**
   Write one statement per job: *When \[situation\], I want to \[motivation\], so I can \[outcome\].*
   Two jobs are two pieces of work.
   Say so, and take the main one first.
3. **The path today.**
   List each step the person takes now, including workarounds outside the product.
   Mark each place where the person waits, guesses, leaves or asks someone.
   These places are the opportunities.
4. **What is still missing.**
   Ask only what the sources and the earlier answers do not settle.
   Start with the assumptions that the design depends on.

Then write the brief.

## The brief

- **Problem**: what happens, to whom, and with what consequence.
  No solution in this line.
- **Job**: the statements from move 2.
- **Path today**: the steps from move 2, with the pain points marked.
  Say how you learned them: screenshots, the code path, or why neither was possible.
- **Success criteria**: outcomes that a person can observe, each able to fail a concept.
  Mark each as a *threshold* (a concept that fails it is out) or a *trade-off* (weighed against the others).
  Add the project's design rules and mark them too.
- **Existing designs**: the proposed solution, prototype or criteria that the issue already holds, and whether the criteria are binding.
- **Constraints**: the surfaces, and the limits that the docs state.
- **Out of scope**: what this proposal does not touch.
- **Evidence**: a table of claim, label and source.
- **Added by the exploration**: the facts and sources that the issue does not hold.
- **Open questions**: the assumptions that remain, and who can answer each one.

### Criteria that can fail

| Weak           | Strong                                                           |
| -------------- | ---------------------------------------------------------------- |
| "Feels modern" | "Uses only components that exist today"                          |
| "Feels simple" | "A new person sends a first message after three choices at most" |
| "Scales"       | "Shows 400 items without paging"                                 |

## The exploration is not done when

- A solution hides in the problem statement.
- No success criterion can fail a concept.
- The brief adds nothing that the issue did not already say.
- Most facts are only *reported* or *assumed*.
- A persona has a name, an age and a quote.
