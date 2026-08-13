#!/usr/bin/env node
// Strip comments from TS/JS/Go source files across the repo.
//
// Usage:
//   node scripts/strip-comments.mjs              dry run, prints what would change
//   node scripts/strip-comments.mjs --write      rewrite files in place
//   node scripts/strip-comments.mjs [paths...]   limit to files/dirs (tracked files only)
//   node scripts/strip-comments.mjs --verbose    print every removed comment
//
// TS/JS files are lexed with the real TypeScript parser (regex literals,
// template strings, and JSX make naive regex stripping unsafe). Go files use a
// small lexer below; Go has no regex literals, so lexing it by hand is safe.
//
// Comments that change build or tool behavior are kept (directives like
// //go:build, @ts-expect-error, eslint-disable). Generated files are skipped.
// After --write, run the repo format task so prettier/gofmt clean up spacing.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const ts = loadTypescript();

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const GO_EXTENSION = '.go';

// Comments matching any of these stay. They are instructions to tools, not prose.
const PRESERVE_TS = [
  /^\/\/\/\s*<(reference|amd-)/, // triple-slash directives
  /@ts-(ignore|expect-error|nocheck|check)/,
  /eslint-(disable|enable|env)|eslint\s/,
  /prettier-ignore/,
  /biome-ignore/,
  /oxlint-disable/,
  /(istanbul|c8|v8)\s+ignore/,
  /@vitest-environment/,
  /@jsx(ImportSource|Runtime|Frag)?/,
  /@vite-ignore/,
  /webpack[A-Z][a-zA-Z]+:/, // webpack magic comments
  /#__PURE__/,
  /@(license|preserve)/,
  /^\/\*!/,
];
const PRESERVE_GO = [
  /^\/\/go:/, // //go:build, //go:generate, //go:embed, ...
  /^\/\/\s*\+/, // k8s-style markers: +kubebuilder:..., +optional, +build, ...
  /^\/\/line /,
  /^\/\/export /,
  /^\/\/sys/,
  /^\/\/nolint/,
];

// Files whose header marks them as generated are left alone entirely.
const GENERATED_MARKERS = [/Code generated .*DO NOT EDIT/i, /@generated/, /DO NOT EDIT/];

function loadTypescript() {
  try {
    return require('typescript');
  } catch {
    const packagesDir = path.join(repoRoot, 'packages');
    for (const entry of readdirSync(packagesDir)) {
      const candidate = path.join(packagesDir, entry, 'node_modules', 'typescript');
      if (existsSync(candidate)) return require(candidate);
    }
    throw new Error('typescript package not found; run pnpm install first');
  }
}

function listFiles(scopes) {
  const args = ['ls-files', '-z', '--', ...(scopes.length ? scopes : ['.'])];
  const out = execFileSync('git', args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
  return out
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((f) => {
      const ext = path.extname(f);
      return TS_EXTENSIONS.has(ext) || ext === GO_EXTENSION;
    })
    .filter((f) => !/\.gen\.[cm]?[jt]sx?$/.test(f))
    .filter((f) => f !== 'scripts/strip-comments.mjs');
}

function isGenerated(text) {
  const head = text.split('\n', 5).join('\n');
  return GENERATED_MARKERS.some((re) => re.test(head));
}

function shouldPreserve(commentText, patterns) {
  return patterns.some((re) => re.test(commentText));
}

// ---------------------------------------------------------------------------
// TS/JS: collect comment ranges by walking every token of the parsed tree.
// Every comment is leading trivia of some token (trailing comments are leading
// trivia of the next token; end-of-file comments belong to the EOF token).
// ---------------------------------------------------------------------------

function scriptKindFor(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parseTs(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file));
}

function leafTokens(sourceFile) {
  const tokens = [];
  const visit = (node) => {
    // JSDoc appears in the tree as nodes, but lexically it is still comment
    // trivia. Skip the nodes so the JSDoc text lands in a trivia gap below.
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(sourceFile);
    if (children.length === 0) {
      tokens.push(node);
      return;
    }
    for (const child of children) visit(child);
  };
  visit(sourceFile);
  return tokens;
}

function collectTsComments(sourceFile, text) {
  // Comments live only in the trivia gaps between consecutive tokens. Scanning
  // gap by gap (instead of per-token leading trivia) catches same-line trailing
  // comments too, and never looks inside JSX text, where "//" is literal.
  const tokens = leafTokens(sourceFile);
  const shebang = ts.getShebang?.(text);
  const ranges = new Map();
  let gapStart = shebang ? shebang.length : 0;
  for (const token of tokens) {
    const gapEnd = token === tokens[tokens.length - 1] ? token.end : token.getStart(sourceFile);
    if (gapEnd > gapStart) {
      const found = [
        ...(ts.getTrailingCommentRanges(text, gapStart) ?? []),
        ...(ts.getLeadingCommentRanges(text, gapStart) ?? []),
      ];
      for (const r of found) {
        if (r.pos >= gapStart && r.end <= gapEnd) ranges.set(r.pos, r);
      }
    }
    gapStart = token.end;
  }
  return [...ranges.values()].sort((a, b) => a.pos - b.pos);
}

function tokenStream(sourceFile, text) {
  return leafTokens(sourceFile)
    .filter((t) => t.kind !== ts.SyntaxKind.EndOfFileToken)
    .map((t) => text.slice(t.getStart(sourceFile), t.end));
}

// ---------------------------------------------------------------------------
// Go: hand-rolled lexer. States are strings ("...", '...', `...`), line
// comments, and block comments. That is the complete lexical grammar we need.
// ---------------------------------------------------------------------------

function collectGoComments(text) {
  const ranges = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      let end = text.indexOf('\n', i);
      if (end === -1) end = n;
      ranges.push({ pos: i, end, kind: 'line' });
      i = end;
    } else if (c === '/' && text[i + 1] === '*') {
      let end = text.indexOf('*/', i + 2);
      end = end === -1 ? n : end + 2;
      ranges.push({ pos: i, end, kind: 'block' });
      i = end;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < n && text[i] !== c && text[i] !== '\n') {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
    } else if (c === '`') {
      const end = text.indexOf('`', i + 1);
      i = end === -1 ? n : end + 1;
    } else {
      i++;
    }
  }
  return ranges;
}

// ---------------------------------------------------------------------------
// Removal. Full-line comments take the whole line with them; inline block
// comments become a space (or a newline in Go when the comment spans lines,
// because Go's semicolon insertion treats such a comment as a newline).
// ---------------------------------------------------------------------------

function removeRanges(text, ranges, { newlineForMultilineBlock }) {
  let result = text;
  for (const r of [...ranges].sort((a, b) => b.pos - a.pos)) {
    const lineStart = result.lastIndexOf('\n', r.pos - 1) + 1;
    const before = result.slice(lineStart, r.pos);
    const isLine = r.kind === 'line';
    let lineEnd = result.indexOf('\n', r.end - 1);
    lineEnd = lineEnd === -1 ? result.length : lineEnd;
    const after = result.slice(r.end, lineEnd);

    if (before.trim() === '' && after.trim() === '') {
      // Comment owns its line(s): drop them entirely.
      const cutEnd = lineEnd === result.length ? lineEnd : lineEnd + 1;
      result = result.slice(0, lineStart) + result.slice(cutEnd);
    } else if (isLine) {
      // Trailing comment after code: drop it and the padding before it.
      const padStart = r.pos - (before.length - before.trimEnd().length);
      result = result.slice(0, padStart) + result.slice(r.end);
    } else {
      const commentText = result.slice(r.pos, r.end);
      const spansLines = commentText.includes('\n');
      const replacement = spansLines && newlineForMultilineBlock ? '\n' : ' ';
      result = result.slice(0, r.pos) + replacement + result.slice(r.end);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Per-file processing
// ---------------------------------------------------------------------------

function processTsFile(file, text) {
  const sourceFile = parseTs(file, text);
  const all = collectTsComments(sourceFile, text);
  const removable = all
    .map((r) => ({
      pos: r.pos,
      end: r.end,
      kind: r.kind === ts.SyntaxKind.SingleLineCommentTrivia ? 'line' : 'block',
    }))
    .filter((r) => !shouldPreserve(text.slice(r.pos, r.end), PRESERVE_TS));
  if (removable.length === 0) return { removed: 0, text };

  // Newline (not space) for multiline block comments: ASI treats a comment
  // containing a line break as a line break, so a space could change meaning.
  const stripped = removeRanges(text, removable, { newlineForMultilineBlock: true });

  // Safety net: the stripped file must produce the identical token stream.
  const before = tokenStream(sourceFile, text);
  const strippedSf = parseTs(file, stripped);
  const after = tokenStream(strippedSf, stripped);
  const originalErrors = sourceFile.parseDiagnostics?.length ?? 0;
  const strippedErrors = strippedSf.parseDiagnostics?.length ?? 0;
  if (before.length !== after.length || before.some((t, i) => t !== after[i]) || strippedErrors > originalErrors) {
    return { removed: 0, text, skippedReason: 'token stream changed after strip, left untouched' };
  }
  return { removed: removable.length, text: stripped, comments: removable };
}

function processGoFile(file, text) {
  const removable = collectGoComments(text).filter(
    (r) => !shouldPreserve(text.slice(r.pos, r.end), PRESERVE_GO),
  );
  if (removable.length === 0) return { removed: 0, text };
  const stripped = removeRanges(text, removable, { newlineForMultilineBlock: true });
  return { removed: removable.length, text: stripped, comments: removable };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const verbose = argv.includes('--verbose');
const scopes = argv.filter((a) => !a.startsWith('--'));

const files = listFiles(scopes);
let totalRemoved = 0;
let changedFiles = 0;
const skipped = [];

for (const file of files) {
  const abs = path.join(repoRoot, file);
  const text = readFileSync(abs, 'utf8');

  if (isGenerated(text)) {
    skipped.push(`${file} (generated)`);
    continue;
  }
  if (file.endsWith('.go') && text.includes('import "C"')) {
    skipped.push(`${file} (cgo preamble comments are code)`);
    continue;
  }

  const result = file.endsWith('.go') ? processGoFile(file, text) : processTsFile(file, text);

  if (result.skippedReason) {
    skipped.push(`${file} (${result.skippedReason})`);
    continue;
  }
  if (result.removed === 0) continue;

  totalRemoved += result.removed;
  changedFiles++;

  if (verbose) {
    for (const c of result.comments) {
      const line = text.slice(0, c.pos).split('\n').length;
      const preview = text.slice(c.pos, c.end).split('\n')[0].slice(0, 100);
      console.log(`${file}:${line} ${preview}`);
    }
  } else {
    console.log(`${write ? 'stripped' : 'would strip'} ${String(result.removed).padStart(4)}  ${file}`);
  }

  if (write) writeFileSync(abs, result.text);
}

console.log(
  `\n${write ? 'Removed' : 'Would remove'} ${totalRemoved} comments across ${changedFiles} files (${files.length} scanned).`,
);
if (skipped.length) {
  console.log(`Skipped ${skipped.length} files:`);
  for (const s of skipped) console.log(`  ${s}`);
}
if (write) {
  console.log('\nNow run the repo format/check tasks (prettier + gofmt) to clean up spacing.');
}
