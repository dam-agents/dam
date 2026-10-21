// TEST_OVERVIEW: the agent's connections panel shows one default-account callout for every kind of Connection that competes for "default": a GitHub host with several accounts and the Agent's storage Connections each get a line naming the current default, in that tool's own words, and a button per other account to make it the default. A kind with a single account offers no choice, and with none the callout is not there.
import type { ConnectionView, Contribution } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DefaultAccountsCallout,
  type GrantDetails,
} from "../../modules/connections/components/default-accounts-callout.js";

const GITHUB: Contribution[] = [
  { kind: "env", name: "GH_TOKEN", placeholder: "token" },
];
const STORAGE: Contribution[] = [
  {
    kind: "egress-sign",
    host: "s3.example.com",
    region: "us-east-1",
    service: "s3",
  },
];

function connection(
  id: string,
  name: string,
  contributions: Contribution[],
): ConnectionView {
  return { id, name, contributions } as unknown as ConnectionView;
}

function html(
  granted: ConnectionView[],
  grants: Record<string, GrantDetails> = {},
): string {
  return renderToStaticMarkup(
    createElement(DefaultAccountsCallout, {
      granted,
      grants: new Map(Object.entries(grants)),
      onPrefer: () => {},
    }),
  );
}

describe("DefaultAccountsCallout", () => {
  // TEST_SCENARIO: an Agent with two GitHub accounts and two storage Connections sees both choices in one callout, each worded for its tool, with the preferred grant named as the default and the other offered as a button.
  it("words each kind's choice for its tool in one callout", () => {
    const out = html(
      [
        connection("gh-a", "Work", GITHUB),
        connection("gh-b", "Personal", GITHUB),
        connection("s3-a", "Lake", STORAGE),
        connection("s3-b", "Archive", STORAGE),
      ],
      {
        "gh-a": { grantedAt: "2026-09-01T00:00:00Z", preferred: false },
        "gh-b": { grantedAt: "2026-09-02T00:00:00Z", preferred: false },
        "s3-a": { grantedAt: "2026-09-01T00:00:00Z", preferred: false },
        "s3-b": { grantedAt: "2026-09-02T00:00:00Z", preferred: true },
      },
    );
    expect(out.match(/data-testid="default-accounts-callout"/g)).toHaveLength(
      1,
    );
    expect(out).toContain(
      "On github.com this agent acts as <strong>Work</strong> unless it switches itself with <code>gh auth switch</code>.",
    );
    expect(out).toContain("Act as Personal by default");
    expect(out).toContain(
      "For Object Storage this agent uses <strong>Archive</strong> unless it names another profile with <code>--profile</code>.",
    );
    expect(out).toContain("Use Lake by default");
    expect(out).not.toContain('data-testid="prefer-connection-gh-a"');
    expect(out).not.toContain('data-testid="prefer-connection-s3-b"');
  });

  // TEST_SCENARIO: one account of each kind leaves nothing to choose, so the panel shows no callout at all.
  it("renders nothing when no kind has a choice", () => {
    expect(
      html([
        connection("gh-a", "Work", GITHUB),
        connection("s3-a", "Lake", STORAGE),
      ]),
    ).toBe("");
  });
});
