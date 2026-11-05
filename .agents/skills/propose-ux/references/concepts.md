# Diverge and converge

Goal: hold several different answers to the same problem, then choose one for reasons that the user can read later.

## Diverge

1. **Fix the criteria and the question.**
   Take the criteria from the accepted brief: its success criteria, and the project's design rules.
   Write them down now, each as a *threshold* or a *trade-off*, before you draw a concept.
   Then write the question that the set must answer.
   A set that answers no question is a portfolio, not an exploration.
2. **Choose the dimension that the decision turns on.**
   The concepts must differ in what the person does:
   - *Sequence*: what is asked first and what waits.
   - *Unit of interaction*: one item, a batch or a stream.
   - *Division of labor*: what the person decides and what the system decides.
   - *Entry point*: where the task begins and what it assumes the person knows.
   - *Commitment point*: how far the person goes before the action cannot be undone.
3. **Draw three concepts, and keep today's flow as the baseline.**
   An existing design is one of the three: it is the concept to beat.
   Use fewer when the stakes are low, and say so.
   Use more only when each concept tests something that the others do not.
4. **Give every concept the same form.**
   - The one thing it tests.
   - The path, as numbered steps that the person takes (Mermaid when it branches).
   - A labelled wireframe, with the existing component named for each part.
   - What it costs the person, and roughly what it costs to build.
5. **Trace the paths.**
   Two concepts with the same steps in the same order are one concept.
   Merge them and find a different third.
6. **Keep the field fair.**
   Use the same fidelity and the same visual language for all.
   Do not write a weak concept to make another one win.
   Drop a concept that you would refuse to build.
7. **Walk each concept alone**, as a first-time person and as a returning one, with the check in `specify.md`.
   When the feature has an agent or an automation that acts on its own, answer the questions in `agent-lens.md` for each concept.
   Do this before any comparison.

## Converge

1. **Apply the criteria from Diverge step 1 to every concept and to the baseline.**
   Add no criterion now.
   A criterion that you add after you see the concepts describes the concept that you already prefer.
2. **Recommend one.**
   Say what it gives up and what would make you reconsider.
3. **Escalate a split.**
   If two concepts each win on a different criterion, the criteria conflict.
   Ask the user to rank them.
   Do not average the two.
4. **Never graft.**
   A feature taken from a rejected concept has no evidence behind it.
5. **Record the choice.**
   - The criteria, with their type.
   - The chosen concept, and what it gives up.
   - For each rejected concept: what it tested, what it lost on, and what would bring it back.

Show the recommendation and the record, then stop.
The user decides.
