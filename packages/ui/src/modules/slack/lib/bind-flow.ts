export function readFlowIdFromSearch(search: string): string | null {
  const flow = new URLSearchParams(search).get("flow");
  return flow && flow.length > 0 ? flow : null;
}

export function readCallbackErrorFromSearch(search: string): string | null {
  return new URLSearchParams(search).get("error");
}

export interface BindErrorCopy {
  title: string;
  hint: string;
  terminal: boolean;
}

export function callbackErrorCopy(
  code: string,
  brandShort: string,
): BindErrorCopy {
  switch (code) {
    case "denied":
      return {
        title: "Login was cancelled",
        hint: `Run \`/${brandShort} bind\` in the Slack channel to try again.`,
        terminal: true,
      };
    case "expired":
      return {
        title: "This bind link has expired",
        hint: `Run \`/${brandShort} bind\` in the Slack channel to get a fresh link.`,
        terminal: true,
      };
    default:
      return {
        title: "Login failed",
        hint: `Run \`/${brandShort} bind\` in the Slack channel to try again.`,
        terminal: true,
      };
  }
}

export function bindErrorCopy(
  code: string | undefined,
  brandShort: string,
): BindErrorCopy {
  switch (code) {
    case "BAD_REQUEST":
      return {
        title: "This link is invalid or has expired",
        hint: `Run \`/${brandShort} bind\` in the Slack channel to get a fresh link.`,
        terminal: true,
      };
    case "CONFLICT":
      return {
        title: "That agent is already connected to this channel",
        hint: "Pick a different agent — a channel can hold several, but each only once.",
        terminal: false,
      };
    case "NOT_FOUND":
      return {
        title: "That agent no longer exists",
        hint: "Pick a different agent.",
        terminal: false,
      };
    default:
      return {
        title: "Something went wrong",
        hint: `Try again — or run \`/${brandShort} bind\` in the channel for a fresh link.`,
        terminal: false,
      };
  }
}
