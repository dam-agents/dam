#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve, normalize } from 'node:path';

const ROOT = process.cwd();
const WIKI = 'wiki';
const PAGES = join(WIKI, 'pages');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(normalize(p));
  }
  return out;
}

const pageFiles = existsSync(PAGES) ? walk(PAGES) : [];
const linkSources = [join(WIKI, 'index.md'), ...pageFiles].filter((f) => existsSync(f));

const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;
const referenced = new Set();
const brokenLinks = [];

for (const file of linkSources) {
  const text = readFileSync(file, 'utf8');
  let m;
  while ((m = LINK_RE.exec(text)) !== null) {
    let target = m[1].trim().split(/\s+/)[0];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    target = target.split('#')[0].split('?')[0];
    if (!target.endsWith('.md')) continue;
    const rel = normalize(relative(ROOT, resolve(dirname(file), target)));
    if (!rel.startsWith(PAGES)) continue;
    referenced.add(rel);
    if (!existsSync(rel)) brokenLinks.push({ from: normalize(file), target: rel });
  }
}

const orphans = pageFiles.filter((p) => !referenced.has(p));

process.stdout.write(`${JSON.stringify({ orphans, brokenLinks }, null, 2)}\n`);
