// TEST_OVERVIEW: the agent's connection pickers find the granted Connection a
// TEST_OVERVIEW: candidate cannot share an agent with, and the panel lists each
// TEST_OVERVIEW: pair an agent already holds, so both can say which account is
// TEST_OVERVIEW: in the way and on which host.
import type { ConnectionView, Contribution } from "api-server-api";
import { describe, expect, test } from "vitest";

import {
  grantBlockedReason,
  grantRivalries,
  grantRivalry,
  grantRivalryWarning,
} from "../../modules/connections/lib/grant-rivals.js";

const githubInject: Contribution = {
  kind: "egress-inject",
  host: "api.github.com",
  headerName: "Authorization",
  valueFormat: "Bearer {value}",
};
const slackContributions: Contribution[] = [
  { ...githubInject, host: "mcp.slack.com" },
  { kind: "mcp-entry", name: "slack", url: "https://mcp.slack.com/mcp" },
];

const connection = (id: string, contributions: Contribution[]) =>
  ({ id, name: id, contributions }) as unknown as ConnectionView;

const githubOAuth = connection("github", [githubInject]);
const githubToken = connection("github-token", [githubInject]);
const slackA = connection("slack-a", slackContributions);
const slackB = connection("slack-b", slackContributions);

describe("grant rivals", () => {
  test("a second GitHub account names the granted one and the host", () => {
    const rivalry = grantRivalry(githubToken, [slackA, githubOAuth]);
    expect(rivalry?.rival.id).toBe("github");
    expect(rivalry && grantBlockedReason(rivalry)).toContain(
      'api.github.com as "github"',
    );
  });

  test("two Slack workspaces are not rivals", () => {
    expect(grantRivalry(slackB, [slackA])).toBeUndefined();
  });

  test("an agent holding both GitHub accounts gets one warning for the pair", () => {
    const rivalries = grantRivalries([
      githubOAuth,
      slackA,
      githubToken,
      slackB,
    ]);
    expect(rivalries).toHaveLength(1);
    const [rivalry] = rivalries;
    expect(rivalry && grantRivalryWarning(rivalry)).toContain(
      '"github" and "github-token" both sign in to api.github.com',
    );
  });
});
