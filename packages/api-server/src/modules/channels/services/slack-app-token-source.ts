export type SlackAppTokenSource =
  | { kind: "static"; token: string }
  | { kind: "rotating"; resolve: () => Promise<string | null> };

export interface RotatingSlackAppToken {
  resolveAppToken: () => Promise<string | null>;
  renew: () => Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Where the Slack Socket Mode connection gets its
 * app-level token, decided by the install's own app-level token rotation
 * switch, which is separate from bot token rotation so that each can be
 * rolled out on its own.
 *
 * With the switch off, the token is the Helm value itself, used as it was
 * before app-level rotation existed: nothing that rotates is built, so no
 * Secret is read or written and Slack is never asked to exchange or renew the
 * token. With the switch on, the rotating token service is built, the socket
 * asks it for the token on every connect, and its renewal joins the periodic
 * token sweep.
 */
export function slackAppTokenSource(opts: {
  helmToken: string;
  rotation: boolean;
  createRotating: () => RotatingSlackAppToken;
}): { source: SlackAppTokenSource; renew: (() => Promise<void>) | null } {
  if (!opts.rotation) {
    return { source: { kind: "static", token: opts.helmToken }, renew: null };
  }
  const rotating = opts.createRotating();
  return {
    source: { kind: "rotating", resolve: rotating.resolveAppToken },
    renew: rotating.renew,
  };
}
