---
name: pr-open
description: >
  Get a pull request ready for an automated code review before its first
  round: self-review the branch the way the reviewer will, run the
  repository's own checks, and write a short body in Simplified Technical
  English (ASD-STE100) that declares the scope, links the issue, gives a human
  reviewer a plain-language guide to the decisions that matter and where to
  look, and records — in a hidden author-decisions block — the decisions the
  person made while the work was built, so the reviewer does not raise them as
  findings. Repo-agnostic and REST-only. Use it whenever an agent or a person
  opens a pull request, pushes a branch for review for the first time, or
  writes or refreshes a PR description — "open a PR", "create the pull
  request", "push this for review", "write the PR body" — even when no
  reviewer is named.
---

# PR open

The first review round reads three things: the diff, the PR body, and the
issue the body links. It loses rounds to a defect the author could have seen
in their own diff, to a change the body does not declare, and to a deliberate
choice it cannot tell from a mistake. This skill closes all three before the
first push. The fix rounds after a review are the `review-remediation`
skill's; it reuses **Self-review** and **The author-decisions block** from
here.

## Inputs

- A git checkout of the branch, its **base branch** (the repository default
  unless the caller names another), and the **repo slug** — derived from the
  checkout when the caller does not give them.
- The conversation that built the branch: the request, the questions put to
  the person and their answers. Where the harness gives the caller a search
  over their own earlier sessions, the sessions that developed this branch
  count too — find them by the branch name.
- `gh` authenticated for the repository, plus `jq`. Use plain REST
  (`gh api`) everywhere — some deployments' auth proxies rewrite only REST
  paths, so GraphQL-backed `gh` subcommands can 401.

## 1. Read the branch

- `git fetch origin <base>`, then `git log origin/<base>..HEAD` and
  `git diff origin/<base>...HEAD` — this range is what the reviewer reads.
- The linked issue: from the conversation, the branch name or a commit
  message. Read it with `gh api repos/<repo>/issues/<n>` and its comments; it
  is what was asked, and the reviewer checks the diff against it.
- An open pull request for the branch:
  `gh api "repos/<repo>/pulls?head=<owner>:<branch>&state=open"`. When one
  exists, its body is the starting point — keep what is true, keep its
  `author-decisions` entries.
- The repository's PR template (`.github/pull_request_template.md`,
  `.github/PULL_REQUEST_TEMPLATE/`, `docs/pull_request_template.md`), when
  there is one.

## 2. Self-review

Read the whole range once, the way the reviewer will: every hunk is a
candidate. Fix what you find, in new commits. The questions are the classes
that most often block a round:

1. **Failure arms.** Every call you added that can fail — a lookup, a parse,
   a probe, an upload, a spawned process — has an error branch, and the
   failure surfaces on at least one channel (a result, a log line, a status).
   An empty result and a failed call never render the same.
2. **State you added.** A new status, counter, flag or cache has a writer, a
   reader and a clearer, and the clearer runs on every path that invalidates
   it — an edit, a removal, a retry, a race with a detached worker. The value
   is attributed to the thing that produced it (identity), not only to the
   fact that something exists (existence).
3. **Conditions.** Whatever has more than one state — a request, a job, a
   connection, a record, a rendered view — has a branch per state, including
   the states that are not the happy one: absent, empty, disabled, refused,
   failed. Text shown under a condition is true under that condition, tense
   included.
4. **Tests.** A test you added fails when your change is reverted, and its
   name promises only what its assertions check. A test that asserts a call
   was made, not the state it produces, is the weak shape the reviewer names.
5. **Statements.** Every sentence you added or changed is true of the code in
   this pull request — not of a planned follow-up. For every rule you changed,
   `git grep` its old term, its new term and its name over the whole tree, and
   settle every hit: architecture pages, glossary, README, diagrams, code
   comments, CLI and tool descriptions, templates, the PR body.
6. **Enumerations and conventions.** A list that enumerates the set you
   extended lists the new member. The conventions this repository states —
   its contributing guide, its agent instructions, the rules its earlier
   reviews repeat — hold for each file you touched.
7. **Scope.** Every hunk belongs to the task or is declared in the body, and
   nothing the task required is missing. A drive-by refactor, rename or
   reformat is reverted, not declared.

Then run the repository's own build, lint and test commands, once, over what
you changed — the ones it already defines, not commands invented here.

## 3. Write the body

Fill the repository's template when it has one; otherwise use these parts.
Write the body in English, in ASD-STE100 (Simplified Technical English):

- One topic per sentence, at most 20 words. Split a longer sentence.
- Active voice, simple tenses, one term per concept, no idioms.
- Short: a reader gets the whole change in two minutes. A bullet is better
  than a paragraph. Keep only what the reader cannot see in the diff title.

The parts:

- **What and why** — two to four sentences: the problem, and what the change
  does about it.
- **Reviewer guide** — see **Reviewer guide** below.
- **Scope** — every behavior, surface and file group the diff changes, the
  side changes included (a doc, a config key, a migration). The reviewer
  reads anything the body does not declare as undeclared scope.
- **Issue** — `Closes #<n>` only when the change delivers all the issue asks;
  `Refs #<n>` and one line on what stays open otherwise. With no issue, one
  line says that no issue tracks the change. A link to a pull request is
  context, never the issue link.
- **Testing** — what ran, with its result; what could not run, and why.
- The `author-decisions` block (**The author-decisions block**).

Every claim in the body is true of this diff, not of a later one.

### Reviewer guide

A section for a person who reads the body and not the code. After it, they
know what the pull request decides and where to look. Name concepts,
behaviors and components, not lines or symbols. Write at most fifteen lines.
For a change with no decision in it (a typo, a version bump), write one line
that says so.

- **What changes in substance** — each architectural decision, one bullet:
  what the pull request decided, the alternative it did not take, and what
  the decision changes for the rest of the system — a contract, a data
  format, a behavior users see, the way it is run.
- **Where to look closely** — two to four places where a mistake costs most
  or the work rests on an assumption: a migration, a concurrency path, a
  security boundary, a behavior change no test covers. Say what could go
  wrong there.
- **Who decided.** A decision the person made or confirmed also has its
  `author-decisions` entry. A decision you made alone appears only here,
  marked `(open)`, so the reviewer judges it.

## 4. Push and open

1. **Push** the branch to `origin` — never force-push a branch that already
   has a review.
2. **Open the pull request only when the caller asked for it** — asking to
   open a pull request is that ask:
   `gh api -X POST repos/<repo>/pulls -f title=<title> -f head=<branch> -f base=<base> -F body=@<file>`.
   When a pull request already exists, the same body goes in with
   `gh api -X PATCH repos/<repo>/pulls/<n> -F body=@<file>`.
   Otherwise hand the caller the body file and that command, ready to run.
3. **Report** the link, the checks that ran, and the decisions the block
   records, one line each. The first review starts on its own; this skill
   never requests one.

## The author-decisions block

The pull request body carries one hidden block that tells the reviewer which
choices the person made on purpose. Write it when the pull request opens, and
update it in every later body edit:

```markdown
<!-- author-decisions
summary: <two or three sentences: what the person asked for, and how the
  work changed on the way>
- <the decision> | scope: <path, behavior or finding> | why: <the person's
  reason, one clause> | <YYYY-MM-DD>
-->
```

- **Only the person's decisions.** An entry is a choice the person stated or
  confirmed in the conversation or in the sessions that built the branch: an answer to a question you put to them, a
  finding they deferred, a trade-off they picked, an option they rejected. A
  choice you made alone and never put to them is not an entry. Write the
  reason in their terms, and never more than they said.
- **The decisions that matter most**, at most ten: the ones a reviewer could
  read as a defect — a behavior left out on purpose, a known limit, a scope
  cut, a rejected alternative. A routine step needs no entry.
- **Precise enough to match.** The reviewer applies an entry only to a
  finding inside its `scope` that its `why` covers. `scope` names the path
  and the behavior (`src/sync/ — no retry on a 409`), never only a theme
  (`error handling`); `why` names the risk the person accepted, not only
  their preference.
- **One block, kept current.** Read the block that is there, keep its entries,
  add the new ones, and replace an entry the person reversed — never a second
  block. Write it in English, with no secret, no personal data and nothing
  from the conversation outside this pull request: the body is public.
- **Not for a `critical` finding.** The reviewer reports a `critical` finding
  whatever an entry says.

## Done

- The range passed the self-review, and the repository's own build and test
  commands pass.
- The body declares every change in the diff, links the issue with the right
  keyword, says what was tested, and its reviewer guide names every
  architectural decision, with the ones you made alone marked `(open)`.
- The `author-decisions` block holds the person's decisions that a reviewer
  could read as a defect.
- The branch is pushed; the pull request is open, or the caller holds the
  body and the command that opens it.
