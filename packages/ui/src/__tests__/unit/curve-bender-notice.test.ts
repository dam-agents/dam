// TEST_OVERVIEW: The CurveBender notice belongs to a chat that does not exist yet, on an install whose shared Connection the person holds. Which variant it shows is read from that chat's pair: already on the shared Connection is "setup", anything else once the pair has settled is "offer", and an unsettled pair shows nothing. It is never shown in the assistant's own chat, whatever the account's cohort, and never to an account that was onboarded with the assistant; and it waits for the assistant record to be read, showing nothing rather than the wrong thing when that read is out or failed.
import type { SessionPair } from "api-server-api";
import { CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID } from "api-server-api";
import { describe, expect, it } from "vitest";

import { curveBenderNotice } from "../../modules/sessions/lib/curve-bender.js";
import type { ProviderConnectionRef } from "../../modules/sessions/lib/session-pair-options.js";

const shared: ProviderConnectionRef = {
  id: "cb",
  name: "CurveBender",
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
const ASSISTANT = "agent-assistant";
/** UNIT_BOUNDARY_DESCRIPTION: the assistant record of an account that had an Agent of its own before the platform made it this one. */
const LEGACY = { agentId: ASSISTANT, legacy: true };
/** UNIT_BOUNDARY_DESCRIPTION: the assistant record of an account onboarded with the assistant. */
const ONBOARDED = { agentId: ASSISTANT, legacy: false };
/** UNIT_BOUNDARY_DESCRIPTION: a new chat of an ordinary agent, on an account that was here before the assistant. */
const ELIGIBLE = {
  sessionId: null,
  pairSettled: true,
  agentId: "agent-1",
  assistant: LEGACY,
  assistantKnown: true,
} as const;

describe("the CurveBender notice", () => {
  // TEST_SCENARIO: the two variants are told apart by the chat's own pair, so a chat already on the shared Connection is not offered a switch to it.
  it("reads the variant from the new chat's pair", () => {
    expect(curveBenderNotice({ ...ELIGIBLE, shared, pair: onShared })).toBe(
      "setup",
    );
    expect(curveBenderNotice({ ...ELIGIBLE, shared, pair: onAnthropic })).toBe(
      "offer",
    );
  });

  // TEST_SCENARIO: a settled chat with no fitting provider is offered CurveBender too, since nothing else would run there.
  it("offers CurveBender where no provider fits", () => {
    expect(curveBenderNotice({ ...ELIGIBLE, shared, pair: null })).toBe(
      "offer",
    );
  });

  // TEST_SCENARIO: an unsettled pair cannot be told apart from one that resolved to CurveBender, so the notice waits rather than flashing the offer.
  it("waits for the pair to settle", () => {
    expect(
      curveBenderNotice({
        ...ELIGIBLE,
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
        ...ELIGIBLE,
        sessionId: "s1",
        shared,
        pair: onShared,
      }),
    ).toBeNull();
    expect(
      curveBenderNotice({ ...ELIGIBLE, shared: undefined, pair: null }),
    ).toBeNull();
  });
});

describe("the notice and the assistant", () => {
  // TEST_SCENARIO: the assistant's own chat is never told about CurveBender, whatever its pair and whichever cohort the account is in — the chat is left to the greeting.
  it("never shows in the assistant's own chat", () => {
    for (const assistant of [LEGACY, ONBOARDED])
      for (const pair of [onShared, onAnthropic, null])
        expect(
          curveBenderNotice({
            ...ELIGIBLE,
            shared,
            pair,
            agentId: assistant.agentId,
            assistant,
          }),
        ).toBeNull();
  });

  // TEST_SCENARIO: an account onboarded with the assistant is never told about CurveBender in any chat, while the same chat on an account that was here first is.
  it("shows nothing to an account onboarded with the assistant", () => {
    for (const pair of [onShared, onAnthropic])
      expect(
        curveBenderNotice({ ...ELIGIBLE, shared, pair, assistant: ONBOARDED }),
      ).toBeNull();
    expect(curveBenderNotice({ ...ELIGIBLE, shared, pair: onAnthropic })).toBe(
      "offer",
    );
  });

  // TEST_SCENARIO: a person with no assistant at all has no record to read, and keeps the notice they always had — as does an Agent they made under the assistant's name, which is not the assistant.
  it("is about the record, not about having one", () => {
    expect(
      curveBenderNotice({
        ...ELIGIBLE,
        shared,
        pair: onAnthropic,
        assistant: null,
      }),
    ).toBe("offer");
    expect(
      curveBenderNotice({
        ...ELIGIBLE,
        shared,
        pair: onAnthropic,
        agentId: "agent-mine",
      }),
    ).toBe("offer");
  });

  // TEST_SCENARIO: the record is still being read — or its read failed — so the notice shows nothing rather than appearing and vanishing, or staying up for a person it does not belong to.
  it("waits for the record, and shows nothing when it cannot be read", () => {
    for (const assistant of [LEGACY, ONBOARDED, null])
      expect(
        curveBenderNotice({
          ...ELIGIBLE,
          shared,
          pair: onAnthropic,
          assistant,
          assistantKnown: false,
        }),
      ).toBeNull();
  });
});
