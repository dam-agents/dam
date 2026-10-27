const PROVIDER_UNAVAILABLE =
  /\b(?:HTTP\/?[\d.]*|status(?: code)?:?|error:?|failed:?)\s*(?:500|502|503|504|529)\b|overloaded|service unavailable|bad gateway|gateway timeout|upstream connect error|upstream request timeout/i;

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether a failed turn's error text says that
 * the model provider is down or overloaded. The web chat and the Slack and
 * Telegram replies use this one rule, so a turn that names the outage in one
 * place names it in the others.
 */
export function saysProviderUnavailable(text: string): boolean {
  return PROVIDER_UNAVAILABLE.test(text);
}
