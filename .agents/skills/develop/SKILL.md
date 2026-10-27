---
name: develop
description: >
  Take a change from request to merged pull request through one fixed process: a GitHub issue, or a free-text description of a feature or bug fix, goes through research of the area it touches (duplicate issues, who built and last changed the code, open and closed pull requests, whether today's behavior was a deliberate decision), a grilling of the plan, the implementation with the repository's own engineering skills, a doc-drift check and a code review, a descriptive report of what was built, and a pull request taken through CI and review to merge.
  Use when the user wants to develop, implement or fix something and hands over an issue link or number or describes the change in words — "develop", "/develop", "implementuj", "oprav", "chci přidat", "work on issue #123".
argument-hint: "<issue URL or number | description of the feature or bug>"
---

# Develop

One process for every change.
Run the steps in order and finish each one before the next.

## 0. Read the input

- **GitHub issue** (URL, `#123`, or a number): read it with its comments (`gh issue view <n> --comments`), and any parent issue and linked pull requests.
  An issue already carries the problem statement, so skip step 1 and go to step 2.
- **Free-text description**: restate it in one or two sentences, so the user can correct the reading before you research it.
  Then run step 1.

## 1. Research the area

Goal: before anything changes, know whether the request is already tracked, where the code came from, who owns it, and whether the behavior the user calls a bug was someone's deliberate decision.
Do the research yourself; ask the user only what the repository cannot answer.

### 1a. Existing issues

Search open and closed issues with several keyword variations: the user's words, the UI text, the identifiers you find in 1b.

```sh
gh issue list --state all --limit 30 --search "<keywords>" --json number,title,state,url
```

Note exact duplicates, close relatives, and issues that change the same area for another reason.
Read the comments of each relevant one: a closed `not planned` issue often carries the reason the behavior stays as it is.

### 1b. Locate the code

Find the files and symbols that implement the area: search for user-visible strings, route names, component and function names.
Name the few files that matter, not every match.

### 1c. History of the area

For each key file or symbol, find who added it, who changed it last, and the changes in between that shaped the behavior in question.
A shallow clone hides history: check `git rev-parse --is-shallow-repository`, and if it prints `true`, run `git fetch --unshallow` or read history through `gh` instead.

```sh
git log --follow --date=short --format='%h %ad %an %s' -- <file>   # whole history of the file; the last line is who added it
git log -S'<symbol or string>' --date=short --format='%h %ad %an %s' # commits that added or removed the exact text
git blame -L <start>,<end> -- <file>                                 # who wrote the lines the user wants to change
gh api repos/{owner}/{repo}/commits/<sha>/pulls --jq '.[] | "#\(.number) \(.title) @\(.user.login) \(.state)"'
```

Map every key commit to its pull request and read the pull request: body, review comments, and discussion (`gh pr view <n> --comments`).
That is where the reasons live.

### 1d. Pull requests in flight and closed

```sh
gh pr list --state all --limit 30 --search "<keywords>" --json number,title,state,author,url
gh pr list --state open --limit 100 --json number,title,author,files \
  --jq '.[] | select(any(.files[]; .path | test("<path regex>"))) | "#\(.number) \(.title) @\(.author.login)"'
```

- **Open** pull requests that touch the same files or behavior: a collision risk, or the change may already be under way.
- **Closed without merge**: someone tried this before; find out why it stopped.
- **Merged**: covered by 1c, but a merged pull request that a keyword search finds and the file history does not can point at a second place that implements the same behavior.

### 1e. Deliberate or accidental

Decide whether the current behavior was intended.
Signs of a deliberate decision: a pull request body or review that names the behavior and argues for it, a test that asserts it, a code comment that explains it, a design or architecture doc that describes it, an issue closed as `not planned`.
Signs of an accident: no discussion anywhere, a later change that broke an earlier intent, a test that does not cover it.

### 1f. Report

Present the research in this shape, short, with links:

```markdown
**Existing issues**: duplicates and close relatives, with state; or "none found" and the keywords searched.
**Where it lives**: the files that matter.
**History**: added in <PR> by @<author> (<date>) — <why, one line>; last changed in <PR> by @<author> (<date>) — <what>; other changes that shaped the behavior.
**In flight**: open pull requests and issues that touch the same area.
**Deliberate or bug**: verdict, with the evidence (one short quote or link each).
**Who to ask**: the people who own the decision, when the change reverses it.
```

Then let the user decide how to go on:

- **Exact duplicate**: work on the existing issue (continue from step 0 with it), comment on it, or stop.
- **Deliberate decision**: confirm that the user wants to reverse it, and suggest talking to its author first.
- **Collision with an open pull request**: wait for it, build on it, or coordinate with its author.
- **Clear to go**: continue to step 2.

## 2. Grill the plan

If the repository has the `grill-me` skill (`.agents/skills/grill-me/` or `.claude/skills/grill-me/`), invoke it with the request and the step 1 report as input.

Without it, run this short version:

- Interview the user about every aspect of the change until you share one understanding.
  Walk each branch of the design, and resolve dependent decisions one at a time.
- Ask one question at a time, give your recommended answer with it, and wait for the reply.
  If the code or the docs can answer a question, look it up instead of asking.
- Check the plan against the repository's architecture and design docs and its glossary of domain terms, if it has them.
  Call out a term used against its defined meaning, and propose a precise term for a vague one.
- Test the boundaries with concrete edge-case scenarios.
- When the user states how something works, check the code and point out any contradiction.
- After each answer, append the question, your recommendation and the decision to a decision log in a temporary file outside the repository, and build the wrap-up from that file.
- Wrap up with the decision log and a list of open questions.

### 2a. Record the outcome

Every change ends this step with an issue that carries it:

- **Input was an issue**: post the decision log on it as a comment.
- **Input was a description**, and step 1 found no issue to reuse: file one with the `file-issue` skill, with the request, the step 1 findings that matter to a reader, and the decision log as input.
  Without `file-issue`, draft the title and body yourself and file it with `gh issue create`.

Show the user the exact text first, and post or file only after they approve it.

A decision that changes the architecture — a new component, a new boundary between parts, a new dependency or data store, a reversed earlier decision — gets a decision record.
Write it with the `adr` skill, or in the repository's own decision-record format (an `adr` or `decisions` folder in its docs) when it has no such skill.
Ask the user first when the repository keeps no decision records at all.

### 2b. Check the size

If the grilling shows the change is too large for one reviewable pull request, offer to split it before any code is written.
With the `plan-feature` and `implement-feature` skills, hand the issue to `plan-feature` and then build with `implement-feature`: they replace steps 3 and 6, while steps 4 and 5 still run before the pull request is marked ready, and step 7 after.
Without them, agree with the user on an ordered list of smaller changes, file each as its own issue, and take each through steps 3 to 7.

## 3. Implement

### 3a. Branch

Work on a fresh branch, never on the default branch or on a branch that carries other work.
Fetch the default branch and branch from its latest commit.
Name the branch by the repository's convention, from its agent instructions or contributing guide; without one, use `<type>/<short-description>` (`feat/…`, `fix/…`).
When the repository's instructions ask for git worktrees, create the branch in one where they say.
If the working tree has uncommitted changes, ask the user what to do with them before you switch.

### 3b. Build

Before writing code, find out which skills this project provides: the skills listed in your session, the skill directories (`.agents/skills/`, `.claude/skills/`), and the agent instructions (`AGENTS.md`, `CLAUDE.md`), which often name the skill to use for each kind of work.
Load every skill that fits the work in front of you — by language, framework, layer, or task (for example a UI skill for frontend code, an architecture skill for backend code, a testing or migration skill) — and follow it over your own habits.
A change that spans several kinds of work loads each fitting skill.
Without a fitting skill, follow the conventions of the surrounding code and the project's written guidelines.

Implement what the decision log from step 2 settled.
When the code shows that a decision does not hold, stop and bring it back to the user instead of deciding it yourself.
Append every decision the user makes from here on, in steps 3 to 5, to the same decision log file, so step 6 finds them all.
An architectural decision made here gets a decision record, as in step 2a.

Decide whether the change needs new tests, and propose them only when it does: a bug fix whose cause a test can pin, logic with edges that manual checking would miss.
Propose the few tests that matter most, not an exhaustive matrix, follow the repository's testing rules, and write them once the user agrees.
Either way, run the existing tests of the packages you touched.

### 3c. Verify in the running app

Passing tests are not proof that the change works.
Start the application and use the change the way its user would: walk the new feature, reproduce the original bug and see it gone, try the edge cases from step 2.
Find how to start it in the project's skills (a skill for running the app or its local environment, often named in the agent instructions) or in its README and contributing guide; Claude Code's built-in `run` skill covers common project types.
For a change the user can see, capture screenshots or a short recording: step 5 shows them, and step 6 puts them in the pull request.
When the app cannot run where you are, say so and why, and list the change as not verified in step 5.

### 3d. Commit

Commit by the repository's rules, from its agent instructions or contributing guide: the message format, scopes, sign-off, trailers, and how many commits a change should have.
Without rules, write Conventional Commits: `type(scope): summary`, with `feat`, `fix`, `docs`, `refactor`, `test`, `chore` and the other standard types.
Let the pre-commit hooks run, and never skip them.
Push only in step 6.

## 4. Check the change

Run both checks on the whole branch diff:

- the `doc-drift` skill, for architecture docs the change leaves out of date;
- the `code-review` skill, Claude Code's built-in review.

Fix what they find and run them again, until neither reports a blocking finding.
A finding you think is wrong goes to the user, not into a silent skip.
When the change touches security-sensitive ground — authentication, authorization, secrets, user input reaching a shell, query or file path, network exposure, cryptography — propose a security review to the user (Claude Code's built-in `security-review` skill), and run it if they agree.
Without `doc-drift`, check the drift yourself: find the documentation that describes the changed area (architecture and design docs, READMEs, API and configuration references, user guides), compare it with the new implementation, and update every statement the change made untrue.

## 5. Report what was built

Before the pull request, give the user a clear, descriptive account of the finished change, written for someone who has not read the diff:

- **Summary**: what the change does, in two or three sentences.
- **New features**: each new capability, what the user can now do and where to find it.
- **Fixes**: each bug fixed, how it behaved before and how it behaves now.
- **Architecture and key parts**: the components, modules, data flows, APIs, schemas or configuration the change added or reshaped, and why; name the few files a reader should open first.
- **Decisions**: the decisions from the log that shaped the result.
- **Not done or not verified**: what was left out, deferred, or not tested.

Show it visually where a picture explains better than text: a diagram of the new component layout or data flow, a before-and-after of the behavior, a screenshot of a UI change.
Use the inline visuals the environment offers (a diagram widget, Mermaid, a screenshot), and stay with text when the change is small.
Then wait for the user: feedback goes back to step 3, a go-ahead continues to step 6.

## 6. Open the pull request

Open it with the `pr-open` skill.
Never open it without the decisions: they are what keeps the reviewer from raising settled questions as findings.
Pass `pr-open` every decision the user made, read from the decision log file of step 2, not from memory, including the ones added in steps 3 to 5; each one goes into its decisions record (in `pr-open`, the `author-decisions` block).
Before opening, check that every decision in the log appears in the body.
Link the issue from step 0 or step 2a, and attach the screenshots or recording from step 3c.
Without `pr-open`, run the repository's checks, then open the pull request with `gh pr create` and a short body that states the scope, links the issue, and lists every decision with its one-line reason.

## 7. Take it to merge

Hand the pull request to the `babysit` skill: it watches CI and the code reviews, fixes the pull request after each round, and asks for the next review, until the reviews approve and CI is green.
Then ask the user for the go-ahead to merge, and let `babysit` follow the merge until the pull request is merged.
Without `babysit`, run the same loop yourself: wait for CI and the reviews, fix every failure and blocking finding in one push per round, and repeat.
