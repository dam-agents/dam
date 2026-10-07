// TEST_OVERVIEW: the agent's connection pickers find the granted Connection a
// TEST_OVERVIEW: candidate cannot share an agent with, and the panel lists each
// TEST_OVERVIEW: pair an agent already holds, so both can say which account is
// TEST_OVERVIEW: in the way and on which host. Accounts that hand the agent a
// TEST_OVERVIEW: token placeholder, such as two GitHub accounts, are not rivals.
import type { ConnectionView, Contribution } from "api-server-api";
import { describe, expect, test } from "vitest";

import {
  grantBlockedReason,
  grantRivalries,
  grantRivalry,
  grantRivalryWarning,
} from "../../modules/connections/lib/grant-rivals.js";

const billingInject: Contribution = {
  kind: "egress-inject",
  host: "billing.acme.internal",
  headerName: "X-API-Key",
  valueFormat: "{value}",
};
const githubContributions: Contribution[] = [
  { kind: "env", name: "GH_TOKEN", placeholder: "dummy-placeholder" },
  {
    kind: "egress-inject",
    host: "api.github.com",
    headerName: "Authorization",
    valueFormat: "Bearer {value}",
  },
];
const slackContributions: Contribution[] = [
  {
    kind: "egress-inject",
    host: "mcp.slack.com",
    headerName: "Authorization",
    valueFormat: "Bearer {value}",
  },
  { kind: "mcp-entry", name: "slack", url: "https://mcp.slack.com/mcp" },
];

const connection = (id: string, contributions: Contribution[]) =>
  ({ id, name: id, contributions }) as unknown as ConnectionView;

const billingA = connection("billing-a", [billingInject]);
const billingB = connection("billing-b", [billingInject]);
const githubOAuth = connection("github", githubContributions);
const githubToken = connection("github-token", githubContributions);
const slackA = connection("slack-a", slackContributions);
const slackB = connection("slack-b", slackContributions);

describe("grant rivals", () => {
  test("a second header credential names the granted one and the host", () => {
    const rivalry = grantRivalry(billingB, [slackA, billingA]);
    expect(rivalry?.rival.id).toBe("billing-a");
    expect(rivalry && grantBlockedReason(rivalry)).toContain(
      'billing.acme.internal as "billing-a"',
    );
  });

  test("two GitHub accounts are not rivals", () => {
    expect(grantRivalry(githubToken, [githubOAuth])).toBeUndefined();
  });

  test("two Slack workspaces are not rivals", () => {
    expect(grantRivalry(slackB, [slackA])).toBeUndefined();
  });

  test("an agent holding both header credentials gets one warning for the pair", () => {
    const rivalries = grantRivalries([billingA, slackA, billingB, slackB]);
    expect(rivalries).toHaveLength(1);
    const [rivalry] = rivalries;
    expect(rivalry && grantRivalryWarning(rivalry)).toContain(
      '"billing-a" and "billing-b" both sign in to billing.acme.internal',
    );
  });
});
