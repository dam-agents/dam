// TEST_OVERVIEW: Interactive artifacts send prompts into the user's open chat, including a newly started conversation without a refresh. Prompts must not reach a terminal, an unavailable chat, or a conversation the user has left.

import { SessionMode } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChatArtifactPrompt } from "../../modules/sessions/hooks/use-chat-artifact-prompt.js";

const current = vi.hoisted(() => ({
  selectedAgent: "agent",
  sessionId: "session",
}));

vi.mock("../../store.js", () => ({
  useStore: { getState: () => current },
}));

type Options = Parameters<typeof useChatArtifactPrompt>[0];

function renderPromptCallback(options: Options) {
  const result: {
    callback: ReturnType<typeof useChatArtifactPrompt> | undefined;
  } = {
    callback: undefined,
  };
  function TestChat() {
    result.callback = useChatArtifactPrompt(options);
    return null;
  }
  renderToStaticMarkup(createElement(TestChat));
  if (!result.callback) throw new Error("Test chat did not render");
  return result.callback;
}

describe("using an interactive artifact in chat", () => {
  const sendPrompt = vi.fn<Options["sendPrompt"]>();
  const options: Options = {
    agentId: "agent",
    sessionId: "session",
    sessionMode: null,
    agentOperable: true,
    loadingSession: false,
    sendPrompt,
  };

  beforeEach(() => {
    current.selectedAgent = "agent";
    current.sessionId = "session";
    sendPrompt.mockReset().mockResolvedValue(undefined);
  });

  // TEST_SCENARIO: A user starts a conversation and publishes an interactive artifact. The new Session has no explicit mode yet, but its artifact must send into chat without a page refresh.
  it("lets the user send an artifact's prompt in a new conversation without refreshing", async () => {
    const sendArtifactPrompt = renderPromptCallback(options);

    await sendArtifactPrompt("Tell me a joke");

    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith("Tell me a joke");
  });

  // TEST_SCENARIO: A user reopens an existing chat. Its artifact must still send the requested prompt into that conversation.
  it("lets the user send an artifact's prompt after reopening a conversation", async () => {
    const sendArtifactPrompt = renderPromptCallback({
      ...options,
      sessionMode: SessionMode.Chat,
    });

    await sendArtifactPrompt("Tell me a joke");

    expect(sendPrompt).toHaveBeenCalledExactlyOnceWith("Tell me a joke");
  });

  // TEST_SCENARIO: The user is working in a terminal. An artifact must not submit a chat prompt to the terminal Session.
  it("does not send an artifact's prompt while the user is in a terminal", async () => {
    const sendArtifactPrompt = renderPromptCallback({
      ...options,
      sessionMode: SessionMode.Terminal,
    });

    await sendArtifactPrompt("Tell me a joke");

    expect(sendPrompt).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: The user has not started a conversation. An artifact cannot create a Session on their behalf.
  it("does not start a conversation when the user has no chat open", async () => {
    const sendArtifactPrompt = renderPromptCallback({
      ...options,
      sessionId: null,
    });

    await sendArtifactPrompt("Tell me a joke");

    expect(sendPrompt).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: The Agent is unavailable for chat. Its artifact must respect the same restriction as the chat sender.
  it("does not send an artifact's prompt when the agent is unavailable", async () => {
    const sendArtifactPrompt = renderPromptCallback({
      ...options,
      agentOperable: false,
    });

    await sendArtifactPrompt("Tell me a joke");

    expect(sendPrompt).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: The user opens a conversation whose Session is still loading. An artifact must wait until that conversation is ready.
  it("does not send an artifact's prompt while the conversation is loading", async () => {
    const sendArtifactPrompt = renderPromptCallback({
      ...options,
      loadingSession: true,
    });

    await sendArtifactPrompt("Tell me a joke");

    expect(sendPrompt).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: The user switches Agents before an old artifact's prompt is handled. That prompt must not be sent after they leave its Agent.
  it("does not send a previous agent's artifact prompt after the user switches agents", async () => {
    const sendArtifactPrompt = renderPromptCallback(options);
    current.selectedAgent = "another-agent";

    await sendArtifactPrompt("Tell me a joke");

    expect(sendPrompt).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: The user switches conversations with the same Agent before an old artifact's prompt is handled. That prompt must not follow them into the other Session.
  it("does not send an old artifact prompt after the user switches conversations", async () => {
    const sendArtifactPrompt = renderPromptCallback(options);
    current.sessionId = "another-session";

    await sendArtifactPrompt("Tell me a joke");

    expect(sendPrompt).not.toHaveBeenCalled();
  });
});
