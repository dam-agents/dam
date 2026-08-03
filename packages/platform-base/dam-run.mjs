#!/usr/bin/env node
// dam-run <cmd>: compatibility shim. The remote Run-executor machinery was
// removed — this now simply runs the command as a regular local process in
// the current pod, inheriting stdio, cwd, and environment. Kept so scripts
// and harness prompts that call `dam-run` keep working unchanged.

import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
if (argv.length === 0) {
  process.stderr.write("usage: dam-run <command> [args...]\n");
  process.exit(2);
}

const child = spawn(argv[0], argv.slice(1), { stdio: "inherit" });
child.on("error", (err) => {
  process.stderr.write(`dam-run: ${argv[0]}: ${err.message}\n`);
  process.exit(127);
});
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 128 + (signalNumber(signal) ?? 0) : 0));
});

function signalNumber(sig) {
  return { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 }[sig];
}
