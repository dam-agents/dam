// TEST_OVERVIEW: The CurveBender notice belongs to a chat that does not exist yet, on an install whose shared Connection the person holds. Which variant it shows is read from that chat's pair: already on the shared Connection is "setup", anything else once the pair has settled is "offer", and an unsettled pair shows nothing.
import type { SessionPair } from "api-server-api";
import { CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID } from "api-server-api";
import { describe, expect, it } from "vitest";

import { curveBenderNotice } from "../../modules/sessions/lib/curve-bender.js";
import type { ProviderConnectionRef } from "../../modules/sessions/lib/session-pair-options.js";

const shared: ProviderConnectionRef = {
  id: "cb",
  name: "CurveBender (shared)",
  type: "curve-bender",
  templateId: CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
};
const anthropic: ProviderConnectionRef = {
  id: "ant",
  name: "Anthropic",
  type: "anthropic",
  templateId: "anthropic",
};
const onShared: SessionPair = {
  harness: "pi",
  provider: shared.id,
  model: "cb/deepseek-v4.1-flash",
};
const onAnthropic: SessionPair = {
  harness: "claude",
  provider: anthropic.id,
  model: null,
};

describe("the CurveBender notice", () => {
  // TEST_SCENARIO: the two variants are told apart by the chat's own pair, so a chat already on the shared Connection is not offered a switch to it.
  it("reads the variant from the new chat's pair", () => {
    expect(
      curveBenderNotice({
        sessionId: null,
        shared,
        pair: onShared,
        pairSettled: true,
      }),
    ).toBe("setup");
    expect(
      curveBenderNotice({
        sessionId: null,
        shared,
        pair: onAnthropic,
        pairSettled: true,
      }),
    ).toBe("offer");
  });

  // TEST_SCENARIO: a settled chat with no fitting provider is offered CurveBender too, since nothing else would run there.
  it("offers CurveBender where no provider fits", () => {
    expect(
      curveBenderNotice({
        sessionId: null,
        shared,
        pair: null,
        pairSettled: true,
      }),
    ).toBe("offer");
  });

  // TEST_SCENARIO: an unsettled pair cannot be told apart from one that resolved to CurveBender, so the notice waits rather than flashing the offer.
  it("waits for the pair to settle", () => {
    expect(
      curveBenderNotice({
        sessionId: null,
        shared,
        pair: null,
        pairSettled: false,
      }),
    ).toBeNull();
  });

  // TEST_SCENARIO: an open chat and an install without the shared Connection have no notice at all.
  it("has nothing to say to an open chat or a keyless install", () => {
    expect(
      curveBenderNotice({
        sessionId: "s1",
        shared,
        pair: onShared,
        pairSettled: true,
      }),
    ).toBeNull();
    expect(
      curveBenderNotice({
        sessionId: null,
        shared: undefined,
        pair: null,
        pairSettled: true,
      }),
    ).toBeNull();
  });
});
