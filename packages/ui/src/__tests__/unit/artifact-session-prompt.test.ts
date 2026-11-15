// TEST_OVERVIEW: The owner's prompt from an artifact opened outside a chat goes to a session of its own. The toast that says it was sent names the agent, says in plain words that nobody answers that session's permission prompts, and opens the session; a refusal reaches the caller as an error in the person's words.

import type React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { emitToast } from "../../lib/toast.js";
import { cachedAgent } from "../../modules/agents/api/queries.js";
import { useSendArtifactPrompt } from "../../modules/artifacts/api/mutations.js";
import {
  sentNotice,
  useArtifactSessionPrompt,
} from "../../modules/artifacts/hooks/use-artifact-session-prompt.js";
import { useOpenSession } from "../../modules/sessions/hooks/use-open-session.js";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useCallback: <T>(fn: T) => fn,
}));
vi.mock("../../lib/toast.js", () => ({ emitToast: vi.fn() }));
vi.mock("../../modules/agents/api/queries.js", () => ({
  cachedAgent: vi.fn(),
}));
vi.mock("../../modules/artifacts/api/mutations.js", () => ({
  useSendArtifactPrompt: vi.fn(),
}));
vi.mock("../../modules/sessions/hooks/use-open-session.js", () => ({
  useOpenSession: vi.fn(),
}));

describe("artifact session prompt", () => {
  const mutateAsync = vi.fn();
  const openSession = vi.fn();

  function mount(artifactId: string | undefined) {
    let send:
      ((prompt: string, conversation?: string) => Promise<void>) | undefined;
    function Host() {
      send = useArtifactSessionPrompt(artifactId);
      return null;
    }
    renderToStaticMarkup(createElement(Host));
    return send;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSendArtifactPrompt).mockReturnValue({
      mutateAsync,
    } as unknown as ReturnType<typeof useSendArtifactPrompt>);
    vi.mocked(useOpenSession).mockReturnValue(openSession);
    vi.mocked(cachedAgent).mockReturnValue({
      name: "Reporter",
    } as ReturnType<typeof cachedAgent>);
  });

  // TEST_SCENARIO: The agent took the prompt and named its session. The toast names the agent, warns that permission prompts go unanswered, and its button opens that session.
  it("names the agent and opens the session from the toast", async () => {
    mutateAsync.mockResolvedValue({
      ok: true,
      agentId: "agent-1",
      sessionId: "session-1",
    });

    await mount("page")!("Refresh");

    expect(mutateAsync).toHaveBeenCalledExactlyOnceWith({
      artifactId: "page",
      prompt: "Refresh",
    });
    const toast = vi.mocked(emitToast).mock.calls[0]![0];
    expect(toast.message).toBe(sentNotice("Reporter"));
    expect(toast.message).toContain("Reporter");
    expect(toast.message).toContain("permission");
    expect(toast.action?.label).toBe("Open session");
    toast.action!.onClick();
    expect(openSession).toHaveBeenCalledExactlyOnceWith("agent-1", "session-1");
  });

  // TEST_SCENARIO: The page names its conversation. The request carries it, so the server keeps that conversation in a Session of its own.
  it("sends the page's conversation with the prompt", async () => {
    mutateAsync.mockResolvedValue({
      ok: true,
      agentId: "agent-1",
      sessionId: "session-1",
    });

    await mount("page")!("Refresh", "thread-7");

    expect(mutateAsync).toHaveBeenCalledExactlyOnceWith({
      artifactId: "page",
      prompt: "Refresh",
      conversation: "thread-7",
    });
  });

  // TEST_SCENARIO: The agent took the prompt but named no session in time. The toast still says where it went, without a button that opens nothing.
  it("offers no button without a session", async () => {
    mutateAsync.mockResolvedValue({
      ok: true,
      agentId: "agent-1",
      sessionId: null,
    });

    await mount("page")!("Refresh");

    const toast = vi.mocked(emitToast).mock.calls[0]![0];
    expect(toast.message).toBe(sentNotice("Reporter"));
    expect(toast.action).toBeUndefined();
  });

  // TEST_SCENARIO: The agent is at its spend limit. The person gets the reason, and no "sent" toast.
  it("rejects with the reason when the prompt is refused", async () => {
    mutateAsync.mockResolvedValue({ ok: false, reason: "spend-limit" });

    await expect(mount("page")!("Refresh")).rejects.toThrow(
      "The agent reached its spend limit for today, so it did not get this.",
    );
    expect(emitToast).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: A page that may not start a session gets no callback at all.
  it("offers no callback without an artifact", () => {
    expect(mount(undefined)).toBeUndefined();
  });
});
