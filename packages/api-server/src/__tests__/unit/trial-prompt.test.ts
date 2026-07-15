import { describe, expect, it } from "vitest";

import {
  buildTrialPrompt,
  formatByteCap,
} from "../../modules/experiments/domain/trial-prompt.js";

describe("formatByteCap", () => {
  it("renders whole-MiB caps as MiB", () => {
    expect(formatByteCap(10 * 1024 * 1024)).toBe("10 MiB");
    expect(formatByteCap(50 * 1024 * 1024)).toBe("50 MiB");
  });

  it("renders non-whole-MiB caps as raw bytes", () => {
    expect(formatByteCap(1_500_000)).toBe("1500000 bytes");
  });
});

describe("buildTrialPrompt", () => {
  it("quotes the configured candidate cap in the reporting contract", () => {
    const prompt = buildTrialPrompt({
      prompt: "Optimize the widget.",
      armVariation: "",
      maxArtifactBytes: 50 * 1024 * 1024,
    });
    expect(prompt).toContain("capped at 50 MiB");
    expect(prompt).not.toContain("Arm variation:");
  });

  it("keeps the shared prompt first and the variation under its header", () => {
    const prompt = buildTrialPrompt({
      prompt: "Optimize the widget.",
      armVariation: "Use approach B.",
      maxArtifactBytes: 10 * 1024 * 1024,
    });
    expect(prompt.startsWith("Optimize the widget.")).toBe(true);
    expect(prompt).toContain("Arm variation:\nUse approach B.");
    expect(prompt).toContain("capped at 10 MiB");
  });

  it("teaches the direct-upload reporting flow", () => {
    const prompt = buildTrialPrompt({
      prompt: "p",
      armVariation: "",
      maxArtifactBytes: 50 * 1024 * 1024,
    });
    expect(prompt).toContain("request_candidate_upload");
    expect(prompt).toContain("candidateRef");
    expect(prompt).toContain("finish_arm");
  });
});
