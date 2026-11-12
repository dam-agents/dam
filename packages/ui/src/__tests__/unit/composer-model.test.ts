// TEST_OVERVIEW: The model the composer names in a chat follows what the next message is set to run on: the open session's own model, else for a chat not started yet the agent's saved chat default when its runtime routes Session Pairs (the ACP relay fills that default into the new session only then), else the live model of the agent's default harness.
import { describe, expect, it } from "vitest";

import { composerModel } from "../../modules/sessions/lib/session-model.js";

const routing = [{ harnessConfig: true, sessionSettings: ["model"] }];
const base = {
  sessionId: null,
  sessionModel: null,
  chatDefaultModel: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
  carried: routing,
  liveModel: "opus",
};

describe("the model the composer names", () => {
  // TEST_SCENARIO: after Try now saves Pi on CurveBender as the chat default, a new chat names that model, not the default harness's live "opus".
  it("names the chat default in a chat not started yet", () => {
    expect(composerModel(base)).toBe(
      "rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
    );
  });

  // TEST_SCENARIO: an open session names its own model, whatever the chat default is.
  it("names the session's own model", () => {
    expect(
      composerModel({
        ...base,
        sessionId: "s-1",
        sessionModel: {
          sessionId: "s-1",
          configId: "model",
          current: "anthropic/opus",
          choices: [{ value: "anthropic/opus", name: "Opus" }],
        },
      }),
    ).toBe("Opus");
  });

  // TEST_SCENARIO: with no chat default, an open session whose model is not known yet, a runtime too old to route Session Pairs (the relay leaves its new session on the runtime's own defaults), or harnesses not reported yet, the composer keeps naming the live model.
  it("falls back to the live model", () => {
    expect(composerModel({ ...base, chatDefaultModel: null })).toBe("opus");
    expect(composerModel({ ...base, sessionId: "s-1" })).toBe("opus");
    expect(
      composerModel({
        ...base,
        carried: [{ harnessConfig: true, sessionSettings: undefined }],
      }),
    ).toBe("opus");
    expect(composerModel({ ...base, carried: undefined })).toBe("opus");
  });
});
