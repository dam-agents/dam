#!/usr/bin/env node
// Dumb corepack reimplementation. Workaround for chicken-and-egg
// problem of RH HI not including corepack or pnpm.
//
// Expected packageManager: "pnpm@<version>+<algo>.<hex-digest>"
// Example: "pnpm@10.33.4+sha512.1c67b3b3..."
//
// Usage: install-pnpm [path-to-package.json]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pkgJson = process.argv[2] ?? './package.json';
const { packageManager } = JSON.parse(readFileSync(pkgJson, 'utf8'));

const match = /^pnpm@(\d[^+]*)\+([^.]+)\.(.+)$/.exec(packageManager ?? '');
if (!match) {
  console.error(`install-pnpm: expected packageManager='pnpm@<version>+<algo>.<digest>', got: ${packageManager}`);
  process.exit(1);
}
const [, version, algo, expected] = match;

const work = mkdtempSync(join(tmpdir(), 'install-pnpm-'));
try {
  const tgz = join(work, execFileSync('npm', ['pack', `pnpm@${version}`, '--silent'], { cwd: work, encoding: 'utf8' }).trim());
  const actual = createHash(algo).update(readFileSync(tgz)).digest('hex');
  if (actual !== expected) {
    console.error(`install-pnpm: ${algo} mismatch for pnpm@${version}\n  expected: ${expected}\n  actual:   ${actual}`);
    process.exit(1);
  }
  execFileSync('npm', ['install', '-g', tgz], { stdio: 'inherit' });
} finally {
  rmSync(work, { recursive: true, force: true });
}
