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
writeFileSync(`${path}.tmp`, JSON.stringify(settings, null, 2));
renameSync(`${path}.tmp`, path);
