import { type EnvVar, TELEMETRY_IDENTITY_ENV } from "api-server-api";

const AGENT_NAME_ATTR = "platform.agent.name";
const TELEMETRY_MARKER_ENV = "CLAUDE_CODE_ENABLE_TELEMETRY";

function upsertNameAttr(value: string | undefined, agentName: string): string {
  const pair = `${AGENT_NAME_ATTR}=${encodeURIComponent(agentName)}`;
  const others = (value ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "" && !p.startsWith(`${AGENT_NAME_ATTR}=`));
  return [...others, pair].join(",");
}

export function seedTelemetryIdentity(
  env: EnvVar[],
  agentName: string,
  telemetry: boolean,
): EnvVar[] {
  if (!telemetry && !env.some((e) => e.name === TELEMETRY_MARKER_ENV))
    return env;
  const existing = env.find((e) => e.name === TELEMETRY_IDENTITY_ENV);
  const next = {
    name: TELEMETRY_IDENTITY_ENV,
    value: upsertNameAttr(existing?.value, agentName),
  };
  return existing
    ? env.map((e) => (e === existing ? next : e))
    : [...env, next];
}

export function renamedTelemetryIdentity(
  env: EnvVar[],
  agentName: string,
): EnvVar[] | null {
  const existing = env.find(
    (e) =>
      e.name === TELEMETRY_IDENTITY_ENV && e.value.includes(AGENT_NAME_ATTR),
  );
  if (!existing) return null;
  const value = upsertNameAttr(existing.value, agentName);
  if (value === existing.value) return null;
  return env.map((e) => (e === existing ? { ...e, value } : e));
}
