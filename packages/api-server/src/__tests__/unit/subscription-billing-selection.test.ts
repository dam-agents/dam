// TEST_OVERVIEW: Saved chat, Slack and schedule model choices cannot switch between API billing and a native subscription when an owner changes attached Connections.
import { describe, expect, it } from "vitest";
import {
  resolveSessionPair,
  type GrantedProvider,
} from "../../modules/harness-config/domain/session-pair.js";

const subscription: GrantedProvider = {
  id: "subscription",
  type: "chatgpt",
  templateId: "openai-chatgpt",
};
const api: GrantedProvider = {
  id: "api",
  type: "openai",
  templateId: "openai",
};

describe("subscription billing selection", () => {
  // TEST_SCENARIO: Replacing one OpenAI credential path with the other must leave the old default unusable, rather than using the new billing account.
  it.each([
    { model: "chatgpt/gpt-6.1-sol", provider: subscription, replacement: api },
    { model: "openai/gpt-6.1-sol", provider: api, replacement: subscription },
  ])(
    "refuses a saved $model when only the other billing mode remains",
    ({ model, provider, replacement }) => {
      const remembered = { harness: "codex", model, provider: provider.id };
      const inputs = {
        remembered,
        agentHarness: "codex",
        defaultHarness: "codex",
        routed: true,
        fits: () => true,
      };
      expect(
        resolveSessionPair({ ...inputs, granted: [replacement] }),
      ).toMatchObject({ provider: null, model: null });
      expect(
        resolveSessionPair({ ...inputs, granted: [subscription, api] }),
      ).toMatchObject(remembered);
    },
  );
});
