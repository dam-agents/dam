#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const CAPS = { page: 40000, index: 8000 };

const ARCH_DIR = join(REPO_ROOT, "docs", "architecture");
export const INDEX_PATH = join(REPO_ROOT, "docs", "architecture.md");

export function measure(content) {
  return content.length;
}

export function capFor(filePath) {
  const abs = resolve(REPO_ROOT, filePath);
  if (abs === INDEX_PATH) return { kind: "index", cap: CAPS.index };
  const rel = relative(ARCH_DIR, abs);
  const isDirectChild = rel && !rel.startsWith("..") && !rel.includes("/") && rel.endsWith(".md");
  return isDirectChild ? { kind: "page", cap: CAPS.page } : null;
}

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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
