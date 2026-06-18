#!/usr/bin/env node
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

const CONFIG = 'wiki.config.json';
const [cmd, name, sha] = process.argv.slice(2);

function fail(msg) {
  process.stderr.write(`watermark.mjs: ${msg}\n`);
  process.exit(2);
}

const USAGE = 'usage: watermark.mjs read|bump <name> [sha]';

if (cmd !== 'read' && cmd !== 'bump') fail(USAGE);
if (!name) fail(USAGE);

const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
const sources = Array.isArray(config.sources) ? config.sources : [];
const matches = sources.filter((s) => s.repo === name || s.repo?.split('/').pop() === name);

if (matches.length === 0) fail(`unknown source '${name}'`);
if (matches.length > 1) fail(`ambiguous source '${name}' (matches ${matches.length})`);
const source = matches[0];

if (cmd === 'read') {
  process.stdout.write(`${source.watermark_sha ?? ''}\n`);
  process.exit(0);
}

if (!sha) fail('bump requires <sha>');
source.watermark_sha = sha;
source.last_ingested = new Date().toISOString().slice(0, 10);

const tmp = `${CONFIG}.tmp`;
writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`);
renameSync(tmp, CONFIG);
process.stdout.write(`${sha}\n`);
