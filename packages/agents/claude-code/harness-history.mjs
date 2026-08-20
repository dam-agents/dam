#!/usr/bin/env node
import { loadHistory } from "./harness-history-lib.mjs";

const sessionId = process.argv[2];
if (!sessionId) {
  process.stderr.write("usage: harness-history.mjs <sessionId>\n");
  process.exit(2);
}

try {
  const lines = await loadHistory(sessionId);
  for (const line of lines) process.stdout.write(`${line}\n`);
  process.stderr.write(`replayed ${lines.length} updates for ${sessionId}\n`);
} catch (error) {
  process.stderr.write(`${String(error?.message ?? error)}\n`);
  process.exit(3);
}
