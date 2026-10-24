/**
 * UNIT_BOUNDARY_DESCRIPTION: whether the Channels panel has anything to show:
 * a messenger this install offers, since binding an Agent's Slack channel or
 * Telegram chat happens there and nowhere else under the experiment. An Agent
 * with no channel yet still needs the panel to bind one.
 */
export function channelsPanelShown(available: {
  slack?: boolean;
  telegram?: boolean;
}): boolean {
  return available.slack === true || available.telegram === true;
}
