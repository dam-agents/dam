import { ANTHROPIC_OAUTH_BETA } from "../../model-catalog/index.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the `anthropic-beta` header a routed call goes
 * out with. Anthropic accepts a subscription (OAuth) token only with the
 * OAuth beta flag, which Claude Code sends when it believes it holds that
 * token; through the router it holds the router's placeholder instead, so
 * the flag is added for a call to the OAuth Connection and removed for every
 * other target, where it means nothing. Every other flag passes as the
 * harness sent it: the LiteLLM proxies ignore the ones they do not know.
 * Undefined when nothing is left to send.
 */
export function anthropicBetaFor(
  sent: string | undefined,
  oauth: boolean,
): string | undefined {
  const flags = (sent ?? "")
    .split(",")
    .map((flag) => flag.trim())
    .filter((flag) => flag !== "" && flag !== ANTHROPIC_OAUTH_BETA);
  if (oauth) flags.push(ANTHROPIC_OAUTH_BETA);
  return flags.length > 0 ? flags.join(",") : undefined;
}
