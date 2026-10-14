# Agent changes

Last verified: 2026-10-14

## Overview

An agent often works in more than one git repository in one Session: its main checkout, several worktrees of one repository, clones of other repositories, and temporary clones outside its home.
The **Changes Panel** shows the git state of all of them, the way a pull request shows a diff.
agent-runtime owns everything on this page, because only the pod can read the repositories; the UI reaches it over the agent's tRPC surface, which the api-server relays without reading it.
The panel only shows changes: it never stages, commits or reverts.
Field-level contract: [`packages/agent-runtime-api/`](../../packages/agent-runtime-api/).

## Change sets

A **Change Set** is one worktree of one repository: the repository, the worktree's path and its branch.
The path is always part of what the user sees, because two worktrees of one repository otherwise look the same.

agent-runtime finds repositories in two ways.
It scans the working directory and the agent's home to a bounded depth, skipping dependency trees and the platform's reserved paths.
A scan does not stop at a repository: the home can itself be a repository with others nested inside it, and each of them is its own entry, its files never counted as the parent's changes.
It also adds the repository of every path a Session edited, wherever that path is.
Every worktree git knows for a found repository is listed under it, also one outside the scanned roots.

For each Change Set the runtime reports the size of its change against its **base** — the merge-base with the repository's default branch, the same diff a pull request shows — the commits ahead of that base, and whether anything is still uncommitted.
Untracked files are part of the change.
It also links the open pull request of the branch.
The lookup goes through the agent's own GitHub connection, so the credential gateway decides it like any call the agent makes: an agent with no GitHub connection gets no link.
Lookups are cached for a short time, because every refresh would otherwise ask GitHub again.

A diff compares a Change Set to its base or to its last commit (the uncommitted part only).
Large diffs are cut per file and overall, and the answer says so; the panel then names the file it cannot show rather than failing.
The runtime serves diffs only for Change Sets it found, so the call cannot read an arbitrary directory.

## Freshness

The list stays fresh without polling.
While a viewer watches, the runtime watches the roots for new repositories, and each Change Set's git directory and top-level entries, with the same file watcher the file tree uses.
It never watches a whole working tree: a dependency tree in it would cost one kernel watch per directory, shared with the agent's own tools.
Every tool call that finishes is the second signal, and it covers edits inside the tree, by an edit tool or a shell command alike.
Notices are throttled; each one only tells the viewer to read the list again.

## Sessions and their repositories

agent-runtime reads each edit tool call a Session makes as it passes through, and records the repository it touched, the branch at that moment and when.
That record is per Session and survives the panel being closed and the pod restarting; it is bounded per Session and in total.
The open pull request of a recorded branch is attached to the record when the panel finds it, and when the Session's tool calls settle.
A link once found is kept, so a Session still links its pull request after it is merged.

The sessions list carries this record as badges of the repositories a Session touched, each with its pull request.
The panel uses it to open on the Change Set the Session edited last, and to group the list: *changed in this Session* first, then other repositories with changes, then clean ones.
When the agent goes on to edit another Change Set, the panel stays where the user is and marks the other one with a new-changes dot.
