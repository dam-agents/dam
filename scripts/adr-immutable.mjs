#!/usr/bin/env node
// check:adr-immutable — enforce the ADR log is append-only.
//
// The ADR read model rests on one invariant: an accepted decision is never
// rewritten. This is the deterministic, unbypassable gate for it (no LLM),
// sibling to db:check:generated. The review-time ADR-policy skill calls this
// same script for unified surfacing but never owns the invariant.
//
// What is frozen: the prose body (markdown after the frontmatter block) of any
// ADR that is under the regime. Frontmatter fields (status, summary, supersedes,
// subsystem, tags) are NOT hashed — their correctness is a judgment call routed
// to the ADR-policy skill, and `status` is explicitly mutable (supersession is
// derived, deprecation flips it). Deletion and rename of a frozen ADR are
// forbidden: deletion rewrites history, rename breaks the id.
//
// Regime marker: an ADR is frozen once its base version has frontmatter and is
// not proposed/DRAFT. This bootstraps the log — pre-frontmatter ADRs (and the
// migration/renumber commit that introduces frontmatter) are exempt because
// their base version carries no frontmatter; every ADR is frozen forward once
// the frontmatter migration lands on main.
//
// Modes (same script, different base — precommit is fast, CI is authoritative):
//   node scripts/adr-immutable.mjs --staged       base = HEAD, head = index
//   node scripts/adr-immutable.mjs --merge-base    base = merge-base(main), head = HEAD

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { splitFrontmatter, parseFrontmatter } from "./adr-index.mjs";

const ADR_DIR = "docs/adrs";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 26 });
}

// Read a file at a git revision. rev "" means the staged index (`git show :path`).
// Returns null when the path does not exist at that revision.
function show(rev, path) {
  try {
    return execFileSync("git", ["show", `${rev}:${path}`], {
      encoding: "utf8",
      maxBuffer: 1 << 26,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

// An ADR is frozen once it has frontmatter and is not proposed/DRAFT. DRAFT
// files carry `status: proposed`, so the status check covers them.
function isFrozen(raw) {
  if (raw == null) return false;
  const { frontmatter } = splitFrontmatter(raw);
  if (!frontmatter) return false;
  const fm = parseFrontmatter(frontmatter);
  const status = String(fm.status || "").trim().toLowerCase();
  return !status.startsWith("propos");
}

function bodyHash(raw) {
  const { body } = splitFrontmatter(raw);
  return createHash("sha256").update(body).digest("hex");
}

function resolveMode() {
  if (process.argv.includes("--merge-base")) {
    let base = null;
    for (const ref of ["origin/main", "main"]) {
      try {
        base = git(["merge-base", "HEAD", ref]).trim();
        break;
      } catch {
        // try the next candidate
      }
    }
    if (!base) {
      process.stderr.write(
        "❌ check:adr-immutable: cannot resolve a baseline (no origin/main or main reachable).\n"
      );
      process.exit(1);
    }
    return { baseRev: base, headRev: "HEAD", diffArgs: [base, "HEAD"] };
  }
  return { baseRev: "HEAD", headRev: "", diffArgs: ["--cached"] };
}

function main() {
  const { baseRev, headRev, diffArgs } = resolveMode();
  let raw;
  try {
    raw = git(["diff", "--name-status", "-M", ...diffArgs, "--", ADR_DIR]);
  } catch {
    // Sandboxed git bridges (Locki) reject -M. Without rename detection a
    // rename surfaces as D+A and the D still fails the gate — strictly
    // stricter, never looser.
    raw = git(["diff", "--name-status", ...diffArgs, "--", ADR_DIR]);
  }

  const errors = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0];
    const letter = code[0];
    const oldPath = parts[1];
    const newPath = parts[2] || parts[1];
    if (basename(oldPath) === "index.md") continue;

    // Additions and copies never touch a base ADR — new records are free.
    if (letter === "A" || letter === "C") continue;

    const baseRaw = show(baseRev, oldPath);
    if (!isFrozen(baseRaw)) continue;

    if (letter === "D") {
      errors.push(`${oldPath}: deletion forbidden — the ADR log is append-only (rewriting history).`);
      continue;
    }
    if (letter === "R") {
      errors.push(
        `${oldPath} → ${newPath}: rename forbidden — the id is a stable reference; supersede with a new ADR instead.`
      );
      continue;
    }
    // M / T (modify / type change): the prose body must not change.
    const headRaw = show(headRev, newPath);
    if (headRaw == null) {
      errors.push(`${newPath}: cannot read head version to compare — treat as a forbidden change.`);
      continue;
    }
    if (bodyHash(baseRaw) !== bodyHash(headRaw)) {
      errors.push(
        `${newPath}: accepted ADR body changed — the decision is frozen. Only frontmatter (status/summary/supersedes) is mutable; record a new ADR to change the decision.`
      );
    }
  }

  if (errors.length) {
    process.stderr.write("❌ check:adr-immutable: the ADR log is append-only.\n\n");
    for (const e of errors) process.stderr.write(`  - ${e}\n`);
    process.stderr.write("\n");
    process.exit(1);
  }
  process.stdout.write("✅ check:adr-immutable: no accepted ADR body was rewritten, deleted, or renamed.\n");
}

main();
