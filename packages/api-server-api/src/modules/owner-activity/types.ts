// UNIT_BOUNDARY_DESCRIPTION: what the web UI tells the server about its signed-in user: that they use it now, so a request that waits for them reaches them there and not as a Slack card.
export interface OwnerActivityService {
  touch(): Promise<void>;
}
