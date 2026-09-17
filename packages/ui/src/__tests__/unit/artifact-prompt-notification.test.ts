// TEST_OVERVIEW: The artifact message listener shows one notification when its chat callback refuses a prompt. Chat delivery reporting and rejected frame messages must not produce extra notifications.

import type React from "react";
import { createElement, type EffectCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emitToast } from "../../lib/toast.js";
import { useArtifactPrompt } from "../../modules/artifacts/hooks/use-artifact-prompt.js";
import { readArtifactPrompt } from "../../modules/artifacts/lib/artifact-prompt.js";

const effects = vi.hoisted(() => new Set<EffectCallback>());

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useEffect: (effect: EffectCallback) => effects.add(effect),
}));
vi.mock("../../lib/toast.js", () => ({ emitToast: vi.fn() }));
vi.mock("../../modules/artifacts/lib/artifact-prompt.js", () => ({
  readArtifactPrompt: vi.fn(),
}));

describe("artifact prompt notifications", () => {
  const sendPrompt = vi.fn<(prompt: string) => Promise<void>>();
  const cleanups = new Set<() => void>();

  beforeEach(() => {
    vi.clearAllMocks();
    sendPrompt.mockResolvedValue(undefined);
    vi.mocked(readArtifactPrompt).mockReturnValue("Refresh the dashboard");
    vi.stubGlobal("window", new EventTarget());

    function Host() {
      useArtifactPrompt({ current: null }, sendPrompt);
      return null;
    }
    renderToStaticMarkup(createElement(Host));
    for (const effect of effects) {
      const cleanup = effect();
      if (cleanup) cleanups.add(cleanup);
    }
  });

  afterEach(() => {
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
    effects.clear();
    vi.unstubAllGlobals();
  });

  // TEST_SCENARIO: A valid frame prompt is refused by the chat gate. The person must see the refusal reason exactly once.
  it("shows the reason when the chat refuses a prompt", async () => {
    const message = "Open a chat before using this artifact's buttons.";
    sendPrompt.mockRejectedValue(new Error(message));

    window.dispatchEvent(new MessageEvent("message"));
    await Promise.resolve();

    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith("Refresh the dashboard");
    expect(emitToast).toHaveBeenCalledExactlyOnceWith({
      kind: "error",
      message,
    });
  });

  // TEST_SCENARIO: The chat sender handles accepted prompts and reports its own delivery failures. The listener must not add a second notification when that sender resolves.
  it("leaves accepted prompt reporting to chat", async () => {
    window.dispatchEvent(new MessageEvent("message"));
    await Promise.resolve();

    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith("Refresh the dashboard");
    expect(emitToast).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: Frame validation rejects a message before it reaches chat. Untrusted or malformed messages must not trigger notifications.
  it("ignores messages rejected by frame validation", async () => {
    vi.mocked(readArtifactPrompt).mockReturnValue(null);

    window.dispatchEvent(new MessageEvent("message"));
    await Promise.resolve();

    expect(sendPrompt).not.toHaveBeenCalled();
    expect(emitToast).not.toHaveBeenCalled();
  });
});
