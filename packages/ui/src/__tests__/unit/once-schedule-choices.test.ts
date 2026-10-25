// TEST_OVERVIEW: What a one-time task's update carries. The server replaces the choices it is given, so a form that sent only what the user touched deleted the harness, model and settings the task ran on: every shown choice travels instead. A task on a profile sends the profile and no inline values, so the reference stays; one on its own values sends them, and a value the user cleared is left out, so the task goes back to the agent's chat default.
import { describe, expect, it } from "vitest";

import { onceUpdateChoices } from "../../modules/schedules/forms/once-form-schema.js";

describe("a one-time task's update choices", () => {
  /** TEST_SCENARIO: the choices the task already holds travel on a task-only edit, so nothing is dropped. */
  it("sends the choices the form shows", () => {
    expect(
      onceUpdateChoices({
        profile: "",
        harness: "claude-code",
        model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
        settings: { effort: "high" },
      }),
    ).toEqual({
      harness: "claude-code",
      model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
      settings: { effort: "high" },
    });
  });

  /** TEST_SCENARIO: a task on a profile sends the profile alone, so the reference survives the update. */
  it("sends the profile instead of its values", () => {
    expect(
      onceUpdateChoices({
        profile: "profile-1",
        harness: "claude-code",
        model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
        settings: { effort: "high" },
      }),
    ).toEqual({ profile: "profile-1" });
  });

  /** TEST_SCENARIO: a choice the user cleared is left out, and a blank setting is no setting. */
  it("leaves a cleared choice out", () => {
    expect(
      onceUpdateChoices({
        profile: "",
        harness: "",
        model: "",
        settings: { effort: "" },
      }),
    ).toEqual({});
  });
});
