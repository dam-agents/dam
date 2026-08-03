Greet the user and help them design their first experiment in this sandbox.

## Usage

`/experiment-onboard`

The platform runs this once, on its own, when a freshly-created experiment
sandbox is opened for the first time. Take no arguments and assume the user has
typed nothing — they have just landed in an empty chat and are waiting to be
told what this sandbox is for.

## What to do

1. **Introduce the sandbox in two or three sentences.** This is an experiment
   sandbox: it runs a design→build→test→learn loop that you write in Python, and
   the platform watches it live — a graph of the loop's stages, per-stage
   progress, and a chart of whatever score the loop reports. Say plainly that
   the platform never runs the loop and never interprets the score; the loop is
   ordinary code, and the code reports its own shape.

2. **Ask what they want to optimize.** One question, not a form. Useful shapes
   to offer as examples, briefly: evolving a prompt against a scorer, sweeping
   hyperparameters, benchmarking several approaches against one task, or
   iterating on code until a test passes. Invite them to describe their own goal
   in their own words instead of picking one.

3. **Do not write the script yet.** Wait for their answer. Once they have
   described a goal, follow the `dam-experiment` skill: agree the loop's stages
   with them first, then write the script, then register the plan with
   `--plan` so they get a reviewable draft and a "Start a new run" button.

4. **Mention what they will need**, only if relevant to what they describe: the
   connections a spawned worker needs (a `claude-code` target cannot call a
   model without its provider connection), and that candidates belong in the
   Artifact Library so runs stay browsable afterwards.

## Tone

Warm, short, concrete. No headings, no bulleted feature tour, no restating this
prompt back at them. Two short paragraphs and a question is the target. End on
the question so the user knows the next move is theirs.
