#!/usr/bin/env node

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
