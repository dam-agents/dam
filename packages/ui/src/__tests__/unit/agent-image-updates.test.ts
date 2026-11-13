// TEST_OVERVIEW: The web app never asks its owner to update an Agent or to think about its image version. The platform moves an Agent to its Template's current image by itself, so the notices above a conversation and the badges beside an Agent's name say what is happening without an Update button, a version, or an offer to update anything. No component of the web app offers an update any more: the button, its hover card and the mutation behind them are gone.
import { AGENT_PERMISSIONS } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import type { AgentView } from "../../types.js";

const { ContributionGapNotice } =
  await import("../../modules/agents/components/contribution-gap-notice.js");
const { RuntimeOutdatedNotice } =
  await import("../../modules/agents/components/runtime-outdated-notice.js");
const { UnsupportedContributionsBadge } =
  await import("../../modules/agents/components/unsupported-contributions-badge.js");
const { SessionPairOutdatedNotice } =
  await import("../../modules/sessions/components/session-pair-outdated-notice.js");

const OWNS = [...AGENT_PERMISSIONS];

// TEST_SCENARIO: an Agent whose Template has moved on and whose runtime is
// TEST_SCENARIO: behind, the two states that used to carry the Update button.
const agent = {
  id: "agent",
  name: "Code Guardian",
  templateId: "default",
  templateUpdate: {
    fromImage: "registry.example/agents/default:old",
    toImage: "registry.example/agents/default:new",
  },
  features: { liveUpdates: false },
  unsupportedContributionKinds: ["mcp-server"],
  access: { role: "owner", editors: [], permissions: OWNS },
} as unknown as AgentView;

// TEST_SCENARIO: what an update affordance looks like in markup: something to
// TEST_SCENARIO: click, the word as a label, or the version talk around it.
// TEST_SCENARIO: "live updates" is the streaming feature and stays allowed, so
// TEST_SCENARIO: the label is matched as the button spells it.
const UPDATE_AFFORDANCE =
  /<button|\bUpdate\b|\bupgrade\b|\boutdated\b|newer version/;

// TEST_SCENARIO: the bar above a conversation says what a behind runtime costs,
// TEST_SCENARIO: without offering to fix it.
it("keeps the runtime notice to what the agent cannot do yet", () => {
  const html = renderToStaticMarkup(createElement(RuntimeOutdatedNotice));
  expect(html).not.toMatch(UPDATE_AFFORDANCE);
  expect(html).toContain("session list");
});

// TEST_SCENARIO: a granted Contribution the runtime does not accept is said
// TEST_SCENARIO: plainly, with no remedy that reads as an update.
it("says a missing contribution without an update to apply", () => {
  const html = renderToStaticMarkup(
    createElement(ContributionGapNotice, { agent }),
  );
  expect(html).not.toMatch(UPDATE_AFFORDANCE);
  expect(html).toContain("running without them");
});

it("badges a missing contribution without an update to apply", () => {
  const html = renderToStaticMarkup(
    createElement(UnsupportedContributionsBadge, { agent }),
  );
  expect(html).not.toMatch(UPDATE_AFFORDANCE);
  expect(html).toContain("Missing config");
});

// TEST_SCENARIO: a runtime too old to route session pairs says only that the
// TEST_SCENARIO: agent cannot choose a model yet.
it("says an agent cannot choose a model without telling anyone to update", () => {
  const html = renderToStaticMarkup(createElement(SessionPairOutdatedNotice));
  expect(html).not.toMatch(UPDATE_AFFORDANCE);
  expect(html).toContain("choose a model");
});
