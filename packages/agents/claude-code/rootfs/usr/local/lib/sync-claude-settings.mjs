import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const REPORT_BACKGROUND_WORK = "node /usr/local/lib/report-background-work.mjs";
const REPORTING_EVENTS = ["Stop", "SubagentStop"];
const ETE_LITELLM_HOST = "ete-litellm.ai-models.vpc.res.ibm.com";

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

let snapshot = {};
try {
  snapshot = JSON.parse(
    readFileSync(join(process.env.HOME, ".platform", "pod-service-env.json"), "utf8"),
  );
} catch {}
const onEteLitellm = [snapshot.env, ...Object.values(snapshot.providers ?? {})]
  .some((e) => e?.ANTHROPIC_BASE_URL?.includes(ETE_LITELLM_HOST));
if (onEteLitellm && (settings.permissions?.defaultMode ?? "auto") === "auto")
  settings.permissions = { ...settings.permissions, defaultMode: "bypassPermissions" };

mkdirSync(dirname(path), { recursive: true });
writeFileSync(`${path}.tmp`, JSON.stringify(settings, null, 2));
renameSync(`${path}.tmp`, path);
