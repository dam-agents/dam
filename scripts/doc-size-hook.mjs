#!/usr/bin/env node
// PreToolUse hook: front-line doc-size enforcement on Write/Edit to
// docs/architecture/**.
//
// It computes the resulting file content, measures it with the shared module,
// and denies the write in-session when it would exceed the cap — so the reason
// lands while the overflowing content is still in the agent's context and it
// reconciles then and there, not at commit time (see docs/design/adr-governance.md).
//
// The authoritative guarantee is the docs:check:doc-size gate; this hook is the
// UX loop. It fails open on any error and never crashes the tool call: a human
// editor or a Bash heredoc bypasses it, and the gate catches those.

import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { capFor, measure, overageReport } from "./doc-size.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function allow() {
  process.exit(0);
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

// Simulate the Edit substitution to get the resulting content. Returns null when
// the edit cannot be applied (missing match), so the tool itself reports it.
function applyEdit(current, input) {
  const { old_string, new_string, replace_all } = input;
  if (old_string == null) return null;
  const next = new_string ?? "";
  if (replace_all) return current.split(old_string).join(next);
  const i = current.indexOf(old_string);
  if (i === -1) return null;
  return current.slice(0, i) + next + current.slice(i + old_string.length);
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    allow();
  }

  const input = payload.tool_input || {};
  const filePath = input.file_path;
  if (!filePath) allow();

  const info = capFor(filePath);
  if (!info) allow();

  let resulting;
  try {
    if (payload.tool_name === "Write") {
      resulting = input.content ?? "";
    } else if (payload.tool_name === "Edit") {
      let current = "";
      try {
        current = readFileSync(resolve(REPO_ROOT, filePath), "utf8");
      } catch {
        current = "";
      }
      resulting = applyEdit(current, input);
      if (resulting == null) allow();
    } else {
      allow();
    }
  } catch {
    allow();
  }

  const size = measure(resulting);
  if (size > info.cap) {
    deny(overageReport({ path: relative(REPO_ROOT, resolve(REPO_ROOT, filePath)), size, cap: info.cap, kind: info.kind }));
  }
  allow();
}

main();
