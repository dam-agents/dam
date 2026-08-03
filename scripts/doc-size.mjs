#!/usr/bin/env node
// check:doc-size — enforce the architecture-doc character budget.
//
// Architecture docs are a hand-maintained, reduced view of the current system;
// the cap keeps them reduced. It is a forcing function, not a byte budget: going
// over means the page dropped to the level of the code, or grew to cover more
// than one subsystem. The remedy is to raise the level, cut volatile detail, or
// split — not to reword to fit, and not to offload description into the ADR log
// (the log holds decisions, not documentation spillover). Precision of the
// number is not the point; a hard limit that forces the re-think is.
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
// identically. Over-cap is a wrong-level or too-broad signal, not a conciseness
// ask, so the ladder leads with raising the level and splitting. It never tells the agent
// to reword to fit, and never to mint an ADR as a spillover bucket: relocating
// is the narrow last case, only for genuine decision rationale, which the log
// already owns from when the decision was made.
export function overageReport({ path, size, cap, kind }) {
  const over = size - cap;
  const label = kind === "index" ? "index (always loaded, hardest cap)" : "page";
  return (
    `${path} is ${size} chars — ${over} over the ${cap}-char ${label} cap.\n` +
    `Over the cap means the page carries too much, not that it is worded verbosely. It is a signal to re-think what belongs here — do not reword or trim meaning to fit. Diagnose the overflow, then reconcile:\n` +
    `  - most often the page has dropped to the level of the code (field names, mechanics, how-it-works detail). Raise the level or cut it — that content is volatile and belongs nowhere durable;\n` +
    `  - if the page has grown to cover more than one subsystem, split it and reconsider the boundaries;\n` +
    `  - only if genuine decision rationale (why X was chosen over Y) has leaked onto the page, cut it. That "why" lives in the ADR log, authored when the decision was made — do not mint a new ADR now to relieve size. The page keeps the why-you-need-to-work-here; the log keeps the why-it-was-decided.`
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
