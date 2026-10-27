# Agent changes

Last verified: 2026-10-27

## Overview

An agent often works in more than one git repository in one Session: its main checkout, several worktrees of one repository, clones of other repositories, and temporary clones outside its home.
The **Changes Panel** shows the git state of all of them, the way a pull request shows a diff.
The UI offers the panel only while the agent has a repository: an agent whose list of Change Sets is empty has nothing to show, so its chat has no Changes tab, and a panel that was open closes.
While the answer is not in yet the tab stays, so it never pops in late on an agent that does have a repository.
agent-runtime owns everything on this page, because only the agent can read the repositories; the UI reaches it over the agent's tRPC surface, which the api-server relays without reading it.
The panel only shows changes: it never stages, commits or reverts.
Field-level contract: [`packages/agent-runtime-api/`](../../packages/agent-runtime-api/).

## Change sets

A **Change Set** is one worktree of one repository: the repository, the worktree's path and its branch.
The path is always part of what the user sees, because two worktrees of one repository otherwise look the same.

agent-runtime finds repositories in two ways.
It scans the working directory and the agent's home to a bounded depth, skipping dependency trees and the platform's reserved paths.
A scan does not stop at a repository: the home can itself be a repository with others nested inside it, and each of them is its own entry, its files never counted as the parent's changes.
It also adds every repository a Session committed or pushed in, wherever it is.
Every worktree git knows for a found repository is listed under it, also one outside the scanned roots.

For each Change Set the runtime reports the size of its change against its **base** — the merge-base with the repository's default branch, the same diff a pull request shows — the commits ahead of that base, and whether anything is still uncommitted.
Untracked files are part of the change.
It also links the open pull request of the branch, with where it stands: a draft, waiting for review, approved, changes requested, merged or closed, and whether it has merge conflicts.
The lookup asks GitHub's GraphQL API, and goes through the agent's own GitHub connection, so the credential gateway decides it like any call the agent makes: an agent with no GitHub connection gets no link.
GitHub matches a head branch by its name alone, so a pull request from a fork's branch of the same name is not taken for the branch's own.
Lookups are cached for a short time, because every refresh would otherwise ask GitHub again.

A diff compares a Change Set to its base or to its last commit (the uncommitted part only).
Large diffs are cut per file and overall, and the answer says so; the panel then names the file it cannot show rather than failing.
The runtime serves diffs only for Change Sets it found, so the call cannot read an arbitrary directory.

## Freshness

The list stays fresh without polling.
While a viewer watches, the runtime watches the roots for new repositories, and each Change Set's git directory and top-level entries, with the same file watcher the file tree uses.
It never watches a whole working tree: a dependency tree in it would cost one kernel watch per directory, shared with the agent's own tools.
Every tool call that finishes is the second signal, and it covers edits inside the tree, by an edit tool or a shell command alike: the runtime does not read what the call did, only that it finished.
Notices are throttled; each one only tells the viewer to read the list again.

## Sessions and their repositories

agent-runtime records the repositories a Session worked in, from one signal: the git commands that record work on a branch — a commit, a merge, a rebase, a cherry-pick, a push.
Edits are not read: how a harness edits a file differs between harnesses, and a shell command names no file at all, while a commit is the same on every harness.
Work not committed yet links no Session until it is; the panel still lists its repository with its changes.

Every git process in the agent writes its trace — git's own event log, `trace2` — as one file in a directory agent-runtime owns, which the runtime gives each harness and terminal process.
A file, not a socket: a reader that stalls blocks every git command writing to its socket, while files only pile up, and git skips its trace rather than wait once the directory holds two thousand.
The runtime reads a file once its process has exited, keeps the command's name, the worktree it ran in, whether it succeeded and the Session it ran in, then deletes it.
Its watch sees a trace created, at the start of a git process, not finished, so while one is unfinished it looks again every second: a commit that waits on an editor or a slow hook links when it exits.
The trace also carries the command line, which can hold a commit message or a credential passed on it; the runtime never logs or keeps any of it.
A command that only reads (`status`, `log`) or switches branches records nothing, and neither does one that failed.
Nor does a pull, or the merge or rebase it starts as a git process of its own: it brings in work done elsewhere, and the tools an agent runs pull their caches and plugin repositories, which the Session never worked in.

git records only the environment variables it is told to, and those name the Session.
A terminal Session's processes carry the platform's own Session id; a harness sets its own on the shell commands of a chat Session — `CLAUDE_CODE_SESSION_ID` on Claude Code, `CODEX_THREAD_ID` on Codex, `PI_SESSION_ID` on Pi — each the same id the runtime knows the Session by.
Each harness's runtime manifest names its variable (`sessionEnvVar`), so a new harness brings its own without a runtime change; the platform's own variable comes first.
A harness that sets none, Bob today, has a command linked to the only Session running a turn, and to nobody when several are, logged rather than guessed; such a push links no pull request, since someone else may have run it.
A pushed branch is looked up on the remote it tracks.

That record is per Session and survives the panel being closed and the machine restarting; it is bounded per Session and in total.
A Session's pull request is one it pushed to: the open pull request of a branch the Session pushed is attached to that Session's record alone, right after the push and when its tool calls settle, so one opened after the push is found too; a pushed branch is looked up on the remote it tracks, whatever its worktree has checked out since.
A commit links no pull request, and neither does another Session pushing the same branch from the same clone: the panel shows the branch's pull request, but only refreshes the state of one a Session already has.
A link once found is kept, so a Session still links its pull request after it is merged.
Its state is not frozen with it: while someone watches the sessions list, the runtime reads the state of the pull requests the list showed again once a minute, fifty to a query, and a change tells the list to read again.
A merged pull request is not read again: nothing changes it any more.

The sessions list carries this record as badges of the repositories a Session has a pull request in, each with its number, wherever the clone is — `/tmp` included.
A repository the Session only committed in shows no badge: the tools an agent runs commit in repositories of their own too, so a badge without a pull request tells the user nothing.
Each pull request shows once, as `<repository> #<number>`: two clones a Session pushed one branch from link the same one, and its badge stands for the clone the Session edited last; the clone means nothing to the user, so a badge never names it.
A badge's color follows its pull request's state, the way Claude Code colors its pull request indicator: gray for a draft, yellow while review is pending, green once approved, red for changes requested, purple once merged.
A closed pull request is red as on GitHub, with its number struck through so it is not read as changes requested, and merge conflicts show in orange over the review color.
The badge's tooltip names the state, so the color is not the only signal.
The panel uses it to open on the Change Set the Session committed in last, and to group the list: *changed in this Session* first, then other repositories with changes, then clean ones.
When the agent goes on to commit in another Change Set, the panel stays where the user is and marks the other one with a new-changes dot.
