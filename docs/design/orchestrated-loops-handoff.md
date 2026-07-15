# Orchestrated R&D loops: handoff

Status: design handoff, not ratified. Date: 2026-07-14.

The first slice is specified as a PRD: **[#2784](https://github.com/dam-agents/dam/issues/2784) — Campaign tracer slice**. Read that first. This doc does not repeat it. It carries the bigger picture, the decisions a future implementer must not quietly undo, and the work we deliberately left out.

## The idea in one paragraph

Research, optimization, and software development all run the same loop: set a goal, make a candidate, test it, evaluate how close it is, learn, try again. Today the platform can only launch that loop inside a single agent session (Experiments). That breaks the moment two steps have different owners, for example when a reviewer is not the implementer, or a human has to sign off. So we want the platform itself to drive the loop: run each step as its own agent, hold the durable record, and decide when to stop. The intelligence stays in the agents; the structure and durability move to the platform. We call the whole looping effort a **Campaign**.

## What is being built first

The PRD covers it. In short: one approach iterating in depth, a locked four step loop (Make, Test, Eval, curate), fresh agent per step, one knowledge base, and a UI built on the existing Experiments screens that shows the loop running to an approved result. That slice proves the hard core. Everything below is out of scope for it.

## Prototypes

Clickable UX prototypes (static HTML, mock data) live in [`docs/prototypes/loops/`](../prototypes/loops/). They use the working name "Loop" and a software-engineering example (a Ralph style loop that builds a small todo app).

- [`loop-creation-prototype.html`](../prototypes/loops/loop-creation-prototype.html) is the creation wizard: goal, strategy, the four steps (each an image, its connections, and a prompt), then review. It shows the empty sandbox model, the platform wrapper that hands each step its inputs and captures the result over MCP, and the Findings to Knowledge split. Breadth and the synthesizer are locked, since M1 is depth.
- [`loop-detail-prototype.html`](../prototypes/loops/loop-detail-prototype.html) is a running depth loop, one candidate per generation, with the per generation Make, Test, Eval, Curate pipeline and the Knowledge rail. The creation wizard's "Create & run loop" opens it.
- [`loops-evolution-prototype.html`](../prototypes/loops/loops-evolution-prototype.html) sketches the later breadth and synthesizer view (M2, M3), for reference only.
- [`campaign-ux-prototype.html`](../prototypes/loops/campaign-ux-prototype.html) is an earlier depth detail sketch, kept for history.

The prototypes are ahead of this doc on naming (Loop, Knowledge). Treat them as exploration, not a spec.

## Decisions that must survive

These are load bearing. If a future change contradicts one of them, that is a real design reversal, not a detail.

1. **The platform owns the loop's structure, not the agents.** The reason to move the loop out of a single session is not that a session cannot call other agents. It can. The reason is durability and visibility: rounds, the record, and the process metrics only exist if the platform owns them.

2. **Fresh agent every round is about clean thinking, not cost.** Each round starts from nothing so it is an independent attempt with no hidden carry over from a warm session. Only two things are allowed to cross a round boundary: the candidate (in git or wherever it lives) and the knowledge base. Everything else is thrown away on purpose.

3. **The knowledge base is per approach, never shared.** Parallel approaches must stay independent, so they must not read each other's notes, or they converge into the same answer. The only thing shared across approaches is the goal itself, which every agent already gets in its prompt.

4. **Knowledge base: writing is agentic, reading is static.** An agent maintains the knowledge base like an LLM keeping a wiki up to date. Reading it is a plain data read, like reading files from a repo. No agent calls another agent to read. This is what keeps the system simple: there are no agent to agent calls at all in the first slice.

5. **The conductor is deterministic and blind to content.** It only reads a small fixed signal from each step (approve / request changes / fail, an optional score, a done flag, a pointer to the candidate). It never looks inside the work. That is what makes the process reproducible and measurable.

6. **A candidate is always a pointer, and the pointer is immutable.** The platform stores where a candidate is, not what it means. For software that means an immutable commit reference plus a saved copy of the change, so a later round cannot overwrite what an earlier round produced.

7. **A score is opaque in meaning but comparable in value.** The platform never interprets what a score means and never compares scores across approaches. Within one approach it may compare them as higher is better, which is all the stop rules need. The default stop signal is an "approve" verdict, not a score threshold.

8. **Process metrics come from the platform, not the agents.** Rounds taken, cost, and where time went are all things the platform already knows from launching the steps and metering tokens. Nothing new needs to be reported, and because agents do not report them, they cannot be gamed.

## Caveats and watch outs

- **The knowledge base can overflow.** Reading is a plain read of the curated notes, so the agent that maintains those notes has to keep them small enough to fit. If it does not, reads get too big. This is the first thing that breaks at scale.
- **A step that ends silently wedges the loop.** Unlike Experiments, where a missing result is just a missing column, here the next step cannot start. Every step must end either by reporting a result or by declaring it is waiting on something (CI, a human). A bare exit is treated as a failed round. This needs per step liveness with timeouts, which Experiments does not have today.
- **Reproducibility needs a snapshot.** Because the knowledge base changes over time, "what did round 7 actually read" is lost unless the platform saves a copy per round.
- **`docs/architecture/experiments.md` contradicts this.** It says the platform never loops. When this work is ratified that page needs a new section or a sibling page. Do not silently edit it.
- **Names are not final.** "Campaign" and "Lineage" (one approach iterated in depth) are working names.

## Deferred work, roughly in order

1. **Multiple approaches in parallel (breadth).** The first slice runs one. Running several competing approaches at once is the next axis.
2. **Configurable loop shape.** The first slice locks the four step loop. A real need is the software cost ladder (compile, then tests, then AI review, then human review, each gating the next). That needs the loop to become a configurable list of checks so the platform can measure each rung separately.
3. **Evolutionary generations.** Kill weak approaches, spawn variants of strong ones. Depends on breadth.
4. **Optimizing the process, not just recording it.** The first slice shows process metrics. The long term goal is feeding them back to improve the loop itself, first by a human editing the config, much later automatically.
5. **Agent to agent communication.** Not needed while knowledge base reads are static. If a future step genuinely needs to ask another agent something live, this comes back, and the rule that protects it is simple: an agent that can be called must never call another agent, so there can be no loops.
6. **Domain adapters.** Software specific views like a PR and diff for a candidate. These sit on top of the agnostic core, never inside it.
7. **Non software domains.** Software is first because its signals are cleanest. The loop is meant to be domain agnostic, so a research or optimization use should drop onto the same machinery later.
8. **Scale mitigations.** Cheaper models for trivial steps, knowledge base retrieval instead of reading the whole thing, and an escape hatch for steps that are pure code. Do not build these first.
