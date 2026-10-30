// TEST_OVERVIEW: The artifact message listener shows one notification when its chat callback refuses a prompt. Chat delivery reporting and rejected frame messages must not produce extra notifications. With no chat, only a prompt that asks for a session of its own is sent, through the new-session callback.

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
  const newSessionPrompt = vi.fn<(prompt: string) => Promise<void>>();
  const cleanups = new Set<() => void>();

  function mount(
    chat: typeof sendPrompt | undefined,
    newSession?: typeof newSessionPrompt,
  ) {
    function Host() {
      useArtifactPrompt({ current: null }, chat, newSession);
      return null;
    }
    renderToStaticMarkup(createElement(Host));
    for (const effect of effects) {
      const cleanup = effect();
      if (cleanup) cleanups.add(cleanup);
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    sendPrompt.mockResolvedValue(undefined);
    newSessionPrompt.mockResolvedValue(undefined);
    vi.mocked(readArtifactPrompt).mockReturnValue({
      prompt: "Refresh the dashboard",
    });
    vi.stubGlobal("window", new EventTarget());
  });

  afterEach(() => {
    for (const cleanup of cleanups) cleanup();
    cleanups.clear();
    effects.clear();
    vi.unstubAllGlobals();
  });

  // TEST_SCENARIO: A valid frame prompt is refused by the chat gate. The person must see the refusal reason exactly once.
  it("shows the reason when the chat refuses a prompt", async () => {
    mount(sendPrompt);
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
    mount(sendPrompt);
    window.dispatchEvent(new MessageEvent("message"));
    await Promise.resolve();

    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith("Refresh the dashboard");
    expect(emitToast).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: Frame validation rejects a message before it reaches chat. Untrusted or malformed messages must not trigger notifications.
  it("ignores messages rejected by frame validation", async () => {
    mount(sendPrompt);
    vi.mocked(readArtifactPrompt).mockReturnValue(null);

    window.dispatchEvent(new MessageEvent("message"));
    await Promise.resolve();

    expect(sendPrompt).not.toHaveBeenCalled();
    expect(emitToast).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: The owner opened the page from the library, with no chat. A prompt that asks for a session of its own goes to the new-session callback.
  it("sends a prompt that asks for its own session when no chat is docked", async () => {
    vi.mocked(readArtifactPrompt).mockReturnValue({
      prompt: "Refresh the dashboard",
      newSession: true,
    });
    mount(undefined, newSessionPrompt);

    window.dispatchEvent(new MessageEvent("message"));
    await Promise.resolve();

    expect(newSessionPrompt).toHaveBeenCalledExactlyOnceWith(
      "Refresh the dashboard",
    );
  });

  // TEST_SCENARIO: With no chat, a prompt that does not opt in must not open a session, as before.
  it("drops a plain prompt when no chat is docked", async () => {
    mount(undefined, newSessionPrompt);

    window.dispatchEvent(new MessageEvent("message"));
    await Promise.resolve();

    expect(newSessionPrompt).not.toHaveBeenCalled();
    expect(emitToast).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: In a chat, a prompt that asks for its own session still goes into the open chat, where the owner is watching.
  it("keeps a docked chat as the destination even when a page asks for a new session", async () => {
    vi.mocked(readArtifactPrompt).mockReturnValue({
      prompt: "Refresh the dashboard",
      newSession: true,
    });
    mount(sendPrompt, newSessionPrompt);

    window.dispatchEvent(new MessageEvent("message"));
    await Promise.resolve();

    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith("Refresh the dashboard");
    expect(newSessionPrompt).not.toHaveBeenCalled();
  });
});
