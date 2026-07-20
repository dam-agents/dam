---
name: dam-loop
description: Turn a vague goal into a reviewable Design-Build-Test-Learn (DBTL) loop as a workflow.ts script, built on the driver SDK. Use when asked to build a loop, iterate on a goal across generations, set up a make/test/eval/curate loop, evolve a candidate, or "generate a workflow" that a human reviews and runs later. This skill writes the script; it does not run it.
allowed-tools: Bash(node *), Write, Read
---

# DAM loop (DBTL)

A **loop** carries a candidate through Design, Build, Test, and Learn across
generations, each generation a set of fresh sandboxes, until a candidate passes
or a generation cap is hit. This skill helps you turn a human's goal into a
readable `workflow.ts` that runs the loop on top of the [dam-invoke](../dam-invoke/SKILL.md)
SDK.

**Your job here is to write `workflow.ts`, not to run it.** The human reviews the
script, then runs it later with `node workflow.ts`. Treat the script as the
artifact: it must read cleanly top to bottom so a person can see what each
generation does before a single sandbox is spawned.

## The four steps

Each step is one sandbox (`spawn`), and what it does lives entirely in its
prompt:

- **Make** — produce a candidate. Its durable output is a **git ref** it pushes
  through a connection (a branch or commit), returned as a string. Never rely on
  files in the sandbox surviving.
- **Test** — an objective gate. Runs a check (build, tests, a script) and returns
  pass/fail.
- **Eval** — a judgment. Returns a **verdict** (`passed` or `continue`) plus an
  optional **score** and findings.
- **Curate** — the single writer of **knowledge**. Reads the generation's raw
  findings and returns a distilled string that seeds the next Make.

**Select** is plain code, not a sandbox (in a depth loop it's trivial: carry the
one candidate forward).

## What crosses a generation boundary

Only two things. Everything else is discarded, because every node is a fresh
sandbox:

1. **The candidate** — a git ref (string). Durable on its own in the connection,
   so a rerun sees earlier work already pushed.
2. **Knowledge** — a plain string variable threaded round to round in the script.

## Control signal

Eval returns `verdict`:

- `passed` -> the loop `break`s (success).
- `continue` -> the loop iterates with the curated knowledge and latest candidate.

There is no "fail" verdict. Not passing simply continues. Hard stops are `passed`,
the generation cap, or a thrown `InvocationFailed`.

## When a node fails — spawn() THROWS

A sandbox can fail: it runs past its ~60-minute liveness deadline without
reporting, exits silently, or never starts. When that happens **`spawn()` throws
`InvocationFailed`**. An uncaught throw propagates to the top and **kills the whole
`node workflow.ts` process** — one failed node takes down every remaining ticket
and generation. This is the single most common way these workflows die.

Decide the failure policy on purpose:

- **Abort on failure (default, fine for a plain depth loop).** Let it throw. A
  crash loses `knowledge`, but candidates survive as git refs and a rerun is
  cheap. The skeleton below relies on this — it is simple and correct.
- **Best-effort / retry (required the moment you fan out over many items).** If
  you promise "retry up to N" or "carry on across 5 tickets," you MUST wrap each
  spawn in try/catch, or the first failure ends everything. Do not describe retry
  behaviour you have not actually coded. Use this helper:

```ts
// Retry a spawn a few times; return null instead of throwing so the caller
// decides what a dead node means (skip the item, break the loop, record a miss).
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T | null> {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      console.error(`attempt ${i}/${attempts} failed: ${(err as Error).message}`);
    }
  }
  return null; // all attempts failed — the caller must handle null
}
```

Also right-size each node (see the dam-invoke skill):

- **`memory`** — a Make or Test that clones and runs an install/build OOM-kills at
  the template's small default (often 1Gi). Give those steps `memory: "4Gi"` or
  more. An OOM node is failed fast, but it still burns an attempt.
- **`ttlMs`** — give a heavy Make a longer deadline; give a quick gate a short one
  so a wedged node fails in minutes instead of the default hour. Scope each step
  to finish inside its `ttlMs`.

Also don't ask a sandbox for tooling its image can't reach (an egress-denied
`mise`/download install can wedge it until the deadline).

## How to author the workflow

1. **Pin the goal.** Ask the human what "done" means (the passing bar the Eval
   step checks), what the Test gate is, and where candidates live (which
   connection / repo). Do not start writing until the passing bar is concrete.
2. **Discover ids and confirm them with the human** so the file is runnable
   later. Run `listImages()` and `listConnections()` from the driver SDK,
   show the human what is available, and confirm the choice — do not guess. Every
   step that reasons needs an **LLM-capable image** (e.g. `claude-code`, never a
   plain shell image) and a **model connection**; a non-LLM image or a missing
   model connection makes the sandbox fail to start and hang until its deadline.
   Bake the real template id and connection ids into the script (with a comment
   naming them).
3. **Write the prompt builders.** Put all the prose in named functions
   (`makePrompt`, `testPrompt`, `evalPrompt`, `curatePrompt`). The loop body then
   reads as pure DBTL control flow.
4. **Write `workflow.ts`** from the skeleton below.
5. **Present it for review.** Show the human the file and a one-line-per-step
   summary of each generation. Then stop. Do not run it.

## Skeleton (depth loop, population 1)

```ts
// workflow.ts — DBTL loop for: <the goal, in one line>
// Run later with:  node workflow.ts
//
// Each generation spawns fresh sandboxes. Two things cross a boundary: the
// candidate (a git ref, durable in the connection) and `knowledge` (the string
// threaded below). No resumability: if the run crashes, knowledge is lost and
// you rerun from generation 1 — candidates already pushed survive as git refs.

import { spawn, s, InvocationFailed } from "/usr/local/lib/driver-sdk.mjs";

const IMAGE = "<template-id from listImages()>";
const CONNECTIONS = ["<repo-connection-id>", "<model-connection-id>"]; // subset of your grants
const MAX_GENERATIONS = 6;

// ---- what each step does (all prose lives here) ----

function makePrompt(knowledge: string, candidate: string | null): string {
  return [
    `<the task, e.g. implement/improve X in the repo>`,
    candidate ? `Start from the previous candidate: ${candidate}.` : `This is the first attempt.`,
    knowledge ? `What earlier generations learned:\n${knowledge}` : ``,
    `Push your work to a new branch and report its git ref as candidateRef.`,
  ].filter(Boolean).join("\n\n");
}

function testPrompt(candidateRef: string): string {
  return `Check out ${candidateRef}. Run <the objective gate, e.g. the build and tests>. Report pass=true only if it is green.`;
}

function evalPrompt(candidateRef: string): string {
  return `Check out ${candidateRef}. Judge it against: <the passing bar>. Return verdict "passed" if it meets the bar, else "continue", plus a score (higher is better) and your findings.`;
}

function curatePrompt(knowledge: string, findings: string[]): string {
  return [
    `Here is the running knowledge so far:\n${knowledge || "(empty)"}`,
    `Here is what this generation found:\n${findings.map((f, i) => `${i + 1}. ${f}`).join("\n")}`,
    `Rewrite the knowledge into a concise, non-redundant brief that will help the next attempt. Return it as knowledge.`,
  ].join("\n\n");
}

// ---- the loop ----

let knowledge = "";
let candidate: string | null = null;

for (let gen = 1; gen <= MAX_GENERATIONS; gen++) {
  console.log(`\n=== generation ${gen} ===`);

  // These spawns THROW InvocationFailed on failure, which aborts the run — fine for
  // a depth loop (rerun is cheap). For best-effort or multi-item loops, wrap each
  // spawn in withRetry (see "When a node fails" above) and handle a null return.
  const make = await spawn({
    template: IMAGE, connections: CONNECTIONS,
    prompt: makePrompt(knowledge, candidate),
    schema: { candidateRef: "string", findings: "string" },
    label: `make/gen${gen}`,
    memory: "4Gi", // clone + install + build OOMs at the 1Gi default
  });

  const test = await spawn({
    template: IMAGE, connections: CONNECTIONS,
    prompt: testPrompt(make.candidateRef),
    schema: { pass: "boolean", findings: "string" },
    label: `test/gen${gen}`,
    memory: "4Gi",
  });

  const evaluation = await spawn({
    template: IMAGE, connections: CONNECTIONS,
    prompt: evalPrompt(make.candidateRef),
    schema: { verdict: s.enum(["passed", "continue"]), score: "number?", findings: "string" },
    label: `eval/gen${gen}`,
  });

  const curate = await spawn({
    template: IMAGE, connections: [], // curate needs no external state, just the findings
    prompt: curatePrompt(knowledge, [make.findings, test.findings, evaluation.findings]),
    schema: { knowledge: "string" },
    label: `curate/gen${gen}`,
  });

  knowledge = curate.knowledge;
  candidate = make.candidateRef;
  console.log(`gen ${gen}: test=${test.pass ? "pass" : "fail"} verdict=${evaluation.verdict} score=${evaluation.score ?? "n/a"} candidate=${candidate}`);

  if (evaluation.verdict === "passed") {
    console.log(`\nPASSED at generation ${gen}: ${candidate}`);
    break;
  }
}
```

## Breadth (later, population > 1)

Same code, but Make/Test/Eval run over N approaches in a `Promise.all`, and a
`select()` (plain code: top-k by `score`) picks the survivor(s) to carry forward.
`score` becomes required. Keep the depth skeleton unless the human asks for
breadth — depth is breadth with a population of one.

## Caveats to bake into the script and tell the human

- **No resumability.** A crash loses `knowledge` and the loop position. Candidates
  survive as git refs, so a rerun re-sees earlier branches. Design the passing bar
  and Make prompt so a rerun is cheap.
- **spawn() throws on failure.** One uncaught `InvocationFailed` kills the whole run.
  Choose abort vs retry deliberately (see "When a node fails"); never claim retry
  you did not code.
- **~60-minute node ceiling.** A sandbox that runs past its liveness deadline is
  failed. Scope each step to finish well inside it, and make sure the image can
  reach any tooling the step needs (a denied egress install can hang a node until
  the deadline).
- **Sandboxes are unattended.** Each prompt must let the sandbox run end to end
  and make its own calls — no step can wait for a human.
- **Attenuation.** `CONNECTIONS` must be a subset of `listConnections()`. The Make
  and Test steps need the repo connection; every step that runs a model needs the
  model connection. Curate can often run with none.
