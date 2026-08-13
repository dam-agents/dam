#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  repoRoot,
  listFiles,
  isGenerated,
  shouldPreserve,
  parseTs,
  collectTsComments,
  collectGoComments,
  PRESERVE_TS,
  PRESERVE_GO,
  COMMENT_TYPES,
  ts,
} from './strip-comments.mjs';

const SELF = 'scripts/check-comment-types.mjs';

function firstContentLine(commentText) {
  const inner = commentText
    .replace(/^\/\*+/, '')
    .replace(/\*+\/$/, '')
    .replace(/^\/\//, '');
  for (const raw of inner.split('\n')) {
    const line = raw.replace(/^\s*\*\s?/, '').trim();
    if (line !== '') return line;
  }
  return '';
}

function violationFor(content) {
  const m = content.match(/^([A-Z][A-Z0-9_]+):/);
  if (!m) return 'missing type prefix';
  if (!COMMENT_TYPES.includes(m[1])) return `unknown type "${m[1]}"`;
  return null;
}

const scopes = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const violations = [];

for (const file of listFiles(scopes)) {
  if (file === SELF) continue;
  const text = readFileSync(path.join(repoRoot, file), 'utf8');
  if (isGenerated(text)) continue;
  if (file.endsWith('.go') && text.includes('import "C"')) continue;

  let comments;
  let preserve;
  if (file.endsWith('.go')) {
    comments = collectGoComments(text);
    preserve = PRESERVE_GO;
  } else {
    const sf = parseTs(file, text);
    comments = collectTsComments(sf, text).map((r) => ({
      pos: r.pos,
      end: r.end,
      kind: r.kind === ts.SyntaxKind.SingleLineCommentTrivia ? 'line' : 'block',
    }));
    preserve = PRESERVE_TS;
  }

  for (const c of comments) {
    const commentText = text.slice(c.pos, c.end);
    if (shouldPreserve(commentText, preserve)) continue;
    const problem = violationFor(firstContentLine(commentText));
    if (problem) {
      const line = text.slice(0, c.pos).split('\n').length;
      violations.push({ file, line, problem, preview: firstContentLine(commentText).slice(0, 70) });
    }
  }
}

if (violations.length > 0) {
  for (const v of violations) {
    console.error(`${v.file}:${v.line}  ${v.problem}  "${v.preview}"`);
  }
  console.error(
    `\n${violations.length} comment(s) without a registered type prefix.` +
      `\nEvery comment must start with one of: ${COMMENT_TYPES.join(', ')}.` +
      `\nSee docs/guidelines/comment-guidelines.md.`,
  );
  process.exit(1);
}
console.log(`OK: all comments carry a registered type prefix (${COMMENT_TYPES.join(', ')}).`);
