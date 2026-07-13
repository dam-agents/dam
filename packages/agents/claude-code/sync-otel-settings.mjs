// Mirror the harness's OTEL_* env into ~/.claude/settings.json `env` so child
// `claude -p` runs keep exporting telemetry: Claude Code scrubs OTEL_* from the
// env it gives Bash-tool subprocesses (while forwarding TRACEPARENT), but every
// claude process re-applies settings `env` at startup. Runs at harness spawn,
// so an env change (telemetry toggled) is reflected on the next spawn.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const path = join(process.env.HOME, ".claude", "settings.json");
let settings = {};
try {
  settings = JSON.parse(readFileSync(path, "utf8"));
} catch {}

const env = Object.fromEntries(
  Object.entries(settings.env ?? {}).filter(([k]) => !k.startsWith("OTEL_")),
);
for (const [k, v] of Object.entries(process.env))
  if (k.startsWith("OTEL_")) env[k] = v;
if (Object.keys(env).length) settings.env = env;
else delete settings.env;

mkdirSync(dirname(path), { recursive: true });
// Write-then-rename so a concurrent reader never sees a torn file.
writeFileSync(`${path}.tmp`, JSON.stringify(settings, null, 2));
renameSync(`${path}.tmp`, path);
