# Agent lens

Use this lens in phases 2 and 4 when a feature has an agent that works on its own: approvals, schedules, connections, notifications, long runs.
Answer it for every concept, not only for the chosen one.

## Who leads

Make an initiative map.
For each stage, say who leads and how much the agent may do alone.

| Autonomy         | Meaning                                |
| ---------------- | -------------------------------------- |
| Acts alone       | The agent acts and says nothing        |
| Acts and reports | The agent acts, then tells the person  |
| Asks first       | The agent waits for approval           |
| Advises          | The agent proposes, the person does it |

For each handover of control, say how it happens:

- *Explicit*: "I drafted two options.
  Choose one."
- *Implicit*: the agent stops, and the interface shows that it is the person's turn.
- *Negotiated*: the agent offers to go on or to stop.
- *Forced*: the agent cannot decide and hands back.

Stress-test the map.
What happens when the person says nothing at a person-led stage?
What happens when the person takes over at an agent-led stage?
Where does control bounce between the two?

## Where the person steps in

For each point where the person may step in, decide:

- **Trigger**: high stakes, low confidence, or a policy.
- **What the person sees**: enough to decide without opening another page.
- **Choices**: approve, edit, reject or defer.
- **Time limit**: what happens when nobody answers.
  The default must be safe.
  An irreversible action never proceeds in silence.
- **Volume**: group many low-stakes decisions into one batch.

Compare the cost of asking with the cost of not asking.
A prompt that people always click through is a defect.
Ask at the moment of the action, for that action, and not in advance for everything.

## Stop, undo and watch

- The person can stop the work, redirect it, and reverse the last actions.
  Say what cannot be undone before it happens.
- The person always sees the state of the agent: starting, working, waiting for them, failed, done or hibernated.
- A person who returns after hours sees what happened, what waits for them, and what failed.
  Show a summary first and the detail on demand.
- The person can see what the agent did on their behalf.

## What DAM already has

Reuse these devices before you add a new one:

- Home shows what changed since the person last looked, and its approvals panel shows what waits for them.
- The sidebar shows the agents, and the activity under them.
- A blue dot marks unread, and an amber dot marks a session that waits for approval.
- The status indicator shows a hibernated agent.
  A hibernated agent does not run, and some surfaces still render its stored state.
  Design what the person sees and can do then.

## When the work fails

For each way the work can fail, choose one response:

- *Invisible recovery*: retry or fall back, for a small and quick failure.
  Set a retry limit.
- *Transparent recovery*: tell the person what is wrong and what the agent does about it.
- *Participatory recovery*: ask the person for one specific thing.
- *Honest failure*: say that the work cannot finish, say why, and offer a next step.

No failure ends in a dead end.

## Autonomy over time

Start with tight control.
Let the person loosen it, in the place where they decided.
Show the current setting where it matters, and not only in a settings page.
