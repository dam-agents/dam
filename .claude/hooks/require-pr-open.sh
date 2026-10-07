#!/usr/bin/env bash
# PreToolUse(Bash): opening a pull request is denied until the session has
# loaded the pr-open skill. Fails open when the transcript can't be read.
set -euo pipefail

input=$(cat)
cmd=$(jq -r '.tool_input.command // ""' <<<"$input")
transcript=$(jq -r '.transcript_path // ""' <<<"$input")

opens_pr() {
  grep -Eq '(^|[^[:alnum:]_-])gh[[:space:]]+pr[[:space:]]+create' <<<"$cmd" && return 0
  grep -Eq '(^|[^[:alnum:]_-])gh[[:space:]]+api' <<<"$cmd" || return 1
  grep -Eq "repos/[^/[:space:]]+/[^/[:space:]]+/pulls([[:space:]\"']|$)" <<<"$cmd" || return 1
  grep -Eq '(-X|--method)[[:space:]=]*GET' <<<"$cmd" && return 1
  grep -Eq '(-X|--method)[[:space:]=]*POST|[[:space:]](-[fF]|--field|--raw-field|--input)([[:space:]=]|$)' <<<"$cmd"
}

opens_pr || exit 0
[[ -f "$transcript" ]] || exit 0

loaded='Base directory for this skill: [^"\\]*/pr-open(["\\]|$)|<command-name>/pr-open</command-name>'
subagents="${transcript%.jsonl}/subagents"
if grep -Eqs "$loaded" "$transcript" || { [[ -d "$subagents" ]] && grep -Eqrs "$loaded" "$subagents"; }; then
  exit 0
fi

jq -n '{hookSpecificOutput: {
  hookEventName: "PreToolUse",
  permissionDecision: "deny",
  permissionDecisionReason: "This repository opens pull requests through the pr-open skill. Load it with the Skill tool (skill: \"pr-open\"), follow it (self-review, checks, body with the author-decisions block), then open the pull request the way it says."
}}'
