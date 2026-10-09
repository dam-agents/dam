import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const REPORT_BACKGROUND_WORK = "node /usr/local/lib/report-background-work.mjs";
const REPORTING_EVENTS = ["Stop", "SubagentStop"];

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

const hooks = settings.hooks ?? {};
for (const event of REPORTING_EVENTS) {
  const others = (hooks[event] ?? [])
    .map((matcher) => ({
      ...matcher,
      hooks: (matcher.hooks ?? []).filter(
        (hook) => hook.command !== REPORT_BACKGROUND_WORK,
      ),
    }))
    .filter((matcher) => matcher.hooks.length > 0);
  hooks[event] = [
    ...others,
    { hooks: [{ type: "command", command: REPORT_BACKGROUND_WORK }] },
  ];
}
settings.hooks = hooks;

mkdirSync(dirname(path), { recursive: true });
writeFileSync(`${path}.tmp`, JSON.stringify(settings, null, 2));
renameSync(`${path}.tmp`, path);
