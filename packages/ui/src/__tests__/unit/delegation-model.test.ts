// TEST_OVERVIEW: the delegation view names the model each sub-agent ran and flags a run on another model than its driver asked for. A provider prefix that only one side carries is the same model, so it must not read as a substitution.
import { expect, it } from "vitest";

import { delegationModel } from "../../modules/invocations/lib/delegation-state.js";

it("shows the model the sub-agent ran when the driver named none", () => {
  expect(delegationModel(null, ["claude-sonnet-5"])).toEqual({
    ran: "claude-sonnet-5",
    requested: null,
    substituted: false,
  });
});

it("shows only the requested model before any call is recorded", () => {
  expect(delegationModel("gpt-6-astra", undefined)).toEqual({
    ran: null,
    requested: "gpt-6-astra",
    substituted: false,
  });
  expect(delegationModel("gpt-6-astra", []).substituted).toBe(false);
});

it("treats a provider prefix on either side as the same model", () => {
  expect(
    delegationModel("azure/gpt-6-astra", ["gpt-6-astra"]).substituted,
  ).toBe(false);
  expect(
    delegationModel("glm-5-4", ["claude/rits/zai-org/glm-5-4"]).substituted,
  ).toBe(false);
});

it("flags a run on another model than the one asked for", () => {
  expect(delegationModel("glm-5-3", ["rits/zai-org/glm-5-4"])).toEqual({
    ran: "rits/zai-org/glm-5-4",
    requested: "glm-5-3",
    substituted: true,
  });
});

it("does not flag a run that used the asked model among others", () => {
  expect(
    delegationModel("claude-opus-5-5", ["claude-haiku-4-5", "claude-opus-5-5"]),
  ).toEqual({
    ran: "claude-haiku-4-5, claude-opus-5-5",
    requested: "claude-opus-5-5",
    substituted: false,
  });
});
