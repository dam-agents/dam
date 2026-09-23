Greet the user and help them design their first experiment in this sandbox.

## Usage

`/experiment-onboard`

The platform runs this once, on its own, when a freshly-created experiment
sandbox is opened for the first time. Take no arguments and assume the user has
typed nothing — they have just landed in an empty chat and are waiting to be
told what this sandbox is for.

## Read the image catalog before you greet

The greeting names the workers a round can actually run in, so read the catalog
*first* — it is per-deployment, and an image you remember from another sandbox
may be absent or disabled here:

```sh
python3 -c 'import experiment_sdk as x; [print(i["id"], "-", i.get("description") or i["name"]) for i in x.list_images()]'
```

Name only ids this returned, and only ones the `dam-experiment` skill's
[images reference](../dam-experiment/references/images.md) lists as supported
workers — the catalogue also carries images that are not validated for
experiment rounds yet. Offering an image the user cannot actually run costs them
a round of correction and teaches them a menu that does not exist.

## What to do

1. **Introduce the sandbox in two or three sentences.** This is an experiment
   sandbox: it runs a design→build→test→learn loop that you write in Python, and
   the platform watches it live — a graph of the loop's stages, per-stage
   progress, and a chart of whatever score the loop reports. Say plainly that
   the platform never runs the loop and never interprets the score; the loop is
   ordinary code, and the code reports its own shape.

2. **Say where a round runs, and what it can run in.** Each round runs in a
   fresh, throwaway agent. For most goals that is a **general coding agent** —
   `claude-code` by default, and mention that `codex`, `pi-agent` or `bob` are
   the same worker on another provider *if* its credential is set up here. Then
   name the one purpose-built option: `nous`, for hypothesis-driven optimization
   of a repo against a metric. Keep it to a line or two — this is orientation,
   not a catalogue tour.

3. **Ask what they want to optimize.** One question, not a form. Invite them to
   describe their goal in their own words. Do not ask them to pick an image yet
   — the goal decides the image, and step 2 was orientation, not a menu they owe
   you an answer to. `claude-code` is the default precisely so the first
   question can be about their goal and not about credentials.

4. **Offer a bundled starter only if they have no target of their own.** Two
   ship inside the `dam-experiment` skill, and they are already on this pod —
   offer them as one line each and let the user pick:

   - **tiny-cache** — a deliberately slow key/value cache; each round rewrites
     it and throughput across fixed seeds is the score. This is the quick one:
     a general coding agent per round, minutes each.
   - **tiny-search** — a deliberately slow full-text search index with a
     write-path guard metric; a `nous` campaign forms a hypothesis, commits to
     a pass bar, and reports whether the mechanism held. This is the one that
     shows hypothesis-driven optimization, about an hour.

   Follow the skill's
   [tiny-cache](../dam-experiment/references/tiny-cache-starter.md) or
   [tiny-search](../dam-experiment/references/tiny-search-starter.md) reference
   rather than improvising a starter of your own — each says which worker it is
   shaped for and why the other one fits it badly. Both are local copies — the
   code ships in the image, on this pod and on the worker's — so never clone or
   download anything for either one.

5. **Do not write the script yet.** Wait for their answer. Once they have
   described a goal, follow the `dam-experiment` skill: agree the image and the
   loop's stages with them first, then write the script, then register the plan
   with `--plan` so they get a reviewable draft and a "Start a new run" button.

6. **Mention what they will need**, only if relevant to what they describe: the
   connections a spawned worker needs (a `claude-code` target cannot call a
   model without its provider connection), and that candidates belong in the
   Artifact Library so runs stay browsable afterwards.

7. **If their goal fits a purpose-built worker, interview before designing.**
   A goal like "make X faster in repo Y" or "test whether Z helps" is a Nous
   campaign, and the `dam-experiment` skill's Nous section lists the questions
   to settle with them first — target repo, metric and pass condition,
   campaign iterations, seeds, rounds. Ask those *before* proposing stages;
   a Nous run authored on guessed parameters fails hours in, not at review.

## Tone and shape

Warm, short, plain. The greeting must be scannable, not read:

- **Two short paragraphs at most**, then the worker options as a **bulleted
  list** (one line each: name — what it's for, in plain words), then the
  question. Aim under 150 words total.
- **Plain language.** No platform vocabulary in the greeting — no "span",
  "skeleton", "invocation", "division of labor". Say "you write the loop, the
  platform draws it live" and stop; the mechanics can come out later when a
  design needs them.
- No feature tour, no restating this prompt back at them, no caveats they
  haven't earned yet.
- End on the question so the user knows the next move is theirs.
