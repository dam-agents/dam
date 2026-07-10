#!/usr/bin/env node
// check:doc-size — enforce the architecture-doc character budget.
//
// Architecture docs are a projection of the ADR log, capped by construction. The
// cap is a forcing function: when a recompile does not fit, the agent must
// consolidate prose and push detail and rationale down into an ADR rather than
// let the page grow unbounded. The point is not to precisely budget context; it
// is to set a hard limit so the projection stays reduced.
//
// This module is the single measurement shared by two surfaces:
//   - the authoritative gate (this file's `main`, wired as docs:check:doc-size
//     in `mise run check` + CI) — scans the working tree, so it covers human
//     edits and Bash-heredoc writes a tool hook cannot see;
//   - the front-line PreToolUse hook (scripts/doc-size-hook.mjs) — imports the
//     helpers here so the in-session rejection and the gate failure agree.
//
// Unit is characters: deterministic, zero-dependency, stable, and a human can
// eyeball it. A crude proxy for token cost, but precision is not the goal.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Caps in characters, calibrated once and left. The index (the always-loaded
// landing page) is the hot working set, so it carries the hardest cap. The
// per-page cap is the day-one lint ceiling: connections.md (~38k today) is the
// largest page and sits just under it, so the next-most-bloated page feels
// pressure first while the rest keep headroom. Tighten here as pages are consolidated.
export const CAPS = { page: 40000, index: 8000 };

const ARCH_DIR = join(REPO_ROOT, "docs", "architecture");
export const INDEX_PATH = join(REPO_ROOT, "docs", "architecture.md");

export function measure(content) {
  return content.length;
}

// Which cap governs a path, or null when it is not an architecture doc.
//   docs/architecture.md            → index cap
//   docs/architecture/<name>.md     → page cap
// Accepts absolute or repo-relative paths.
export function capFor(filePath) {
  const abs = resolve(REPO_ROOT, filePath);
  if (abs === INDEX_PATH) return { kind: "index", cap: CAPS.index };
  const rel = relative(ARCH_DIR, abs);
  const isDirectChild = rel && !rel.startsWith("..") && !rel.includes("/") && rel.endsWith(".md");
  return isDirectChild ? { kind: "page", cap: CAPS.page } : null;
}

// The steering message, shared so the hook rejection and the gate failure read
// identically. It names the cap as a signal to re-think what the page carries,
// and orders the remedies so relocating and splitting come first and prose
// tightening is the last resort — otherwise the cheapest move (reword to fit)
// is also the first one read, and the agent stops there.
export function overageReport({ path, size, cap, kind }) {
  const over = size - cap;
  const label = kind === "index" ? "index (always loaded, hardest cap)" : "page";
  return (
    `${path} is ${size} chars — ${over} over the ${cap}-char ${label} cap.\n` +
    `Over the cap means this page carries too much — too much detail, or too many concerns — not that it is worded verbosely. Treat it as a signal to re-think what belongs here, not a request to be more concise. Do not trim meaning to fit. Reconcile in this order:\n` +
    `  - move detail and rationale down into an ADR — the log holds the "why", the page keeps the "what";\n` +
    `  - if the page has grown to cover more than one subsystem, split it and reconsider the boundaries;\n` +
    `  - only once the content is right, tighten prose and merge related statements — last, never the first move.`
  );
}

function listPages() {
  return readdirSync(ARCH_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(ARCH_DIR, f));
}

function checkFile(absPath) {
  const info = capFor(absPath);
  if (!info) return null;
  const size = measure(readFileSync(absPath, "utf8"));
  if (size <= info.cap) return null;
  return { path: relative(REPO_ROOT, absPath), size, cap: info.cap, kind: info.kind };
}

function main() {
  const violations = [INDEX_PATH, ...listPages()].map(checkFile).filter(Boolean);
  if (violations.length) {
    process.stderr.write("❌ check:doc-size: architecture docs over budget.\n\n");
    for (const v of violations) process.stderr.write(overageReport(v) + "\n\n");
    process.exit(1);
  }
  process.stdout.write("✅ check:doc-size: all architecture docs within budget.\n");
}

// Run only when invoked directly, so the hook can import helpers without the
// gate running as a side effect (same guard as adr-index.mjs).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
