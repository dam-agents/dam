#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { openSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
if (argv.length === 0) {
  process.stderr.write("usage: platform-bg <command> [args...]\n");
  process.exit(2);
}

const logDir = join(process.env.TMPDIR ?? "/tmp", "platform-bg");
const logPath = join(logDir, `${randomUUID()}.log`);
let out;
try {
  mkdirSync(logDir, { recursive: true });
  out = openSync(logPath, "a");
} catch (err) {
  process.stderr.write(`platform-bg: cannot open ${logPath}: ${err.message}\n`);
  process.exit(1);
}

const child = spawn(argv[0], argv.slice(1), {
  detached: true,
  stdio: ["ignore", out, out],
});
child.on("error", (err) => {
  process.stderr.write(`platform-bg: ${argv[0]}: ${err.message}\n`);
  process.exit(127);
});
child.unref();

const runtime =
  process.env.PLATFORM_RUNTIME_URL ??
  `http://127.0.0.1:${process.env.PORT ?? 8080}`;

try {
  const res = await fetch(`${runtime}/api/declared-processes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pid: child.pid,
      description: argv.join(" ").slice(0, 200),
      log: logPath,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`runtime returned ${res.status}`);
} catch (err) {
  process.stderr.write(
    `platform-bg: started pid ${child.pid} but could not declare it ` +
      `(${err.message}); inside a sandbox it will be reaped once the sandbox ` +
      `goes idle\n`,
  );
  process.stdout.write(`${child.pid}\n`);
  process.exit(1);
}

process.stderr.write(`platform-bg: logging to ${logPath}\n`);
process.stdout.write(`${child.pid}\n`);
