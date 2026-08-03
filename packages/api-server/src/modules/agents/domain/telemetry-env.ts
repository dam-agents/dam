import type { EnvVar } from "api-server-api";

// Resource attribute carrying the user-declared agent name so telemetry from
// one instance is spottable in the exploration UI. Display-only: unlike
// `platform.agent.id` (gateway-stamped, unforgeable), this value is exported
// by the harness itself and must never be used for attribution or authz.
const AGENT_NAME_ATTR = "platform.agent.name";
const RESOURCE_ATTRS_ENV = "OTEL_RESOURCE_ATTRIBUTES";
const TELEMETRY_MARKER_ENV = "CLAUDE_CODE_ENABLE_TELEMETRY";

/** Set or replace `platform.agent.name` inside an OTEL_RESOURCE_ATTRIBUTES
 *  value (comma-separated `key=value` pairs; values percent-encoded per the
 *  W3C Baggage rules the OTel env spec uses). */
function upsertNameAttr(value: string | undefined, agentName: string): string {
  const pair = `${AGENT_NAME_ATTR}=${encodeURIComponent(agentName)}`;
  const others = (value ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "" && !p.startsWith(`${AGENT_NAME_ATTR}=`));
  return [...others, pair].join(",");
}

/**
 * Create-time: when the template env enables telemetry, return a copy with
 * the agent's user-declared name merged into OTEL_RESOURCE_ATTRIBUTES.
 * Env without the telemetry marker passes through untouched.
 */
export function seedTelemetryIdentity(
  env: EnvVar[],
  agentName: string,
): EnvVar[] {
  if (!env.some((e) => e.name === TELEMETRY_MARKER_ENV)) return env;
  const existing = env.find((e) => e.name === RESOURCE_ATTRS_ENV);
  const next = {
    name: RESOURCE_ATTRS_ENV,
    value: upsertNameAttr(existing?.value, agentName),
  };
  return existing
    ? env.map((e) => (e === existing ? next : e))
    : [...env, next];
}

/**
 * Rename-time: rewrite the name attribute only where it already exists, so a
 * rename never adds telemetry env to an agent that doesn't carry it (or that
 * the user stripped it from). Returns null when nothing needs writing.
 */
export function renamedTelemetryIdentity(
  env: EnvVar[],
  agentName: string,
): EnvVar[] | null {
  const existing = env.find(
    (e) => e.name === RESOURCE_ATTRS_ENV && e.value.includes(AGENT_NAME_ATTR),
  );
  if (!existing) return null;
  const value = upsertNameAttr(existing.value, agentName);
  if (value === existing.value) return null;
  return env.map((e) => (e === existing ? { ...e, value } : e));
}
