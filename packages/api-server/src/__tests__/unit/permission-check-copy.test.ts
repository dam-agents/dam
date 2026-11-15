import { describe, it, expect } from "vitest";
import { channelPermissionCheckGuidance } from "../../modules/channels/infrastructure/permission-check-copy.js";

describe("channel permission-check guidance", () => {
  it("is a self-delimited block so it can be concatenated into any prompt", () => {
    const text = channelPermissionCheckGuidance;

    expect(text.startsWith("<permission-check>")).toBe(true);
    expect(text.trimEnd().endsWith("</permission-check>")).toBe(true);
  });

  it("names the mode as the cause, and the agent's tool approval as its owner's to change", () => {
    const text = channelPermissionCheckGuidance;

    expect(text).toContain("permission mode");
    expect(text).toContain("Nothing in this conversation can approve the rest");
    expect(text).toContain(
      "the agent's tool approval, which only the agent's owner changes",
    );
  });

  it("keeps the platform's own tools out of the refusal rule", () => {
    const text = channelPermissionCheckGuidance;

    expect(text).toContain("every tool but the platform's own");
    expect(text).toContain("the relay allows once");
  });

  it("forbids inventing a setting for it", () => {
    const text = channelPermissionCheckGuidance;

    expect(text).toContain(
      "no Connection's scope or repository's permissions grants it",
    );
    expect(text).toContain("never name a setting that does not exist");
  });
});
