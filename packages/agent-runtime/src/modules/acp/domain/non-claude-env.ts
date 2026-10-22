import { isClaudeModel } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the env a harness declares for a process whose
 * session runs any model that is not Claude, the session's own or one a
 * model setting names (its subagent model). Claude Code asks for the
 * server-side auto-mode check on every model call, and only a Claude model
 * answers it; a reply without the check makes Claude Code warn and classify
 * locally. A bare name, a tier word, is no provider's model and counts as
 * Claude.
 */
export function nonClaudeModelEnv(
  env: Readonly<Record<string, string>> | undefined,
  models: readonly (string | null | undefined)[],
): Record<string, string> | undefined {
  if (!env || Object.keys(env).length === 0) return undefined;
  return models.some((model) => !isClaudeModel(model)) ? { ...env } : undefined;
}
