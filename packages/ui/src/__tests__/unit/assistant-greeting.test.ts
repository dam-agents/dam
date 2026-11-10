// @vitest-environment happy-dom
// TEST_OVERVIEW: the greeting an unused assistant opens its chat with: who it is
// TEST_OVERVIEW: and which brand it belongs to, said to the signed-in person by
// TEST_OVERVIEW: name, the ask to hear about their role, and tasks that need
// TEST_OVERVIEW: neither a connection nor personal context. It belongs to the
// TEST_OVERVIEW: owner's own assistant, only while the record says it was never
// TEST_OVERVIEW: used — a mark a Session that just appeared sets at once, so a New
// TEST_OVERVIEW: chat does not bring the greeting back.
import { assistantIdeas } from "api-server-api";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markAssistantUsed } from "../../modules/assistants/api/assistant-state.js";
import { AssistantGreeting } from "../../modules/assistants/components/assistant-greeting.js";
import {
  greetingCopy,
  greetingShown,
  preferredProviderTemplate,
  providerLineFor,
} from "../../modules/assistants/lib/greeting.js";
import { draftKey } from "../../modules/sessions/lib/draft-key.js";
import { queryClient } from "../../query-client.js";
import { useStore } from "../../store.js";
import { trpc } from "../../trpc.js";

const ASSISTANT = "agent-00000000000000a1";
const ON = {
  assistantOn: true,
  assistantId: ASSISTANT,
  selectedAgent: ASSISTANT,
  used: false,
};

const copy = greetingCopy({
  firstName: "Jenna",
  assistantName: "Dammy",
  brandName: "DAM",
  provider: "curve-bender",
});

describe("when the greeting is shown", () => {
  // TEST_SCENARIO: the owner's own assistant, never used, with the feature on for them: the chat opens with the greeting.
  it("is shown to an unused assistant of the owner, with the feature on", () => {
    expect(greetingShown(ON)).toBe(true);
  });

  // TEST_SCENARIO: the feature off for the person, another agent, a record that names no assistant, and an assistant that has been used each leave the chat as it was.
  it("is shown for nothing else", () => {
    expect(greetingShown({ ...ON, assistantOn: false })).toBe(false);
    expect(greetingShown({ ...ON, selectedAgent: "agent-2" })).toBe(false);
    expect(greetingShown({ ...ON, assistantId: null })).toBe(false);
    expect(greetingShown({ ...ON, selectedAgent: null })).toBe(false);
    expect(greetingShown({ ...ON, used: true })).toBe(false);
    expect(greetingShown({ ...ON, used: undefined })).toBe(false);
  });

  // TEST_SCENARIO: the greeting rests on the record's mark alone, so it opens a New chat even when the assistant already has older sessions — and a reset, which clears the mark, brings it straight back.
  it("opens a New chat whatever sessions the assistant already has", () => {
    expect(greetingShown({ ...ON, used: false })).toBe(true);
    expect(greetingShown({ ...ON, used: true })).toBe(false);
    expect(greetingShown({ ...ON, used: false })).toBe(true);
  });
});

describe("what the greeting says", () => {
  // TEST_SCENARIO: the person's given name and the install's assistant and brand names, never a hardcoded one.
  it("names the person and the branded assistant", () => {
    expect(copy.opening).toBe("Hi Jenna! I'm Dammy, your personal DAM agent.");
  });

  // TEST_SCENARIO: a person whose profile holds no given name is greeted without one rather than by a made-up name.
  it("greets without a name when the profile has none", () => {
    for (const firstName of [null, "  "])
      expect(
        greetingCopy({
          firstName,
          assistantName: "Dammy",
          brandName: "DAM",
          provider: "curve-bender",
        }).opening,
      ).toBe("Hi! I'm Dammy, your personal DAM agent.");
  });

  // TEST_SCENARIO: the design's five ideas, each labelled with the kind of work it would be, and the composer's example is one of them.
  it("offers the five labelled ideas", () => {
    expect(assistantIdeas("DAM").map((idea) => idea.label)).toEqual([
      "Artifact",
      "Schedule",
      "Knowledge base",
      "Skill",
      "DAM",
    ]);
    expect(copy.ideas).toEqual(assistantIdeas("DAM"));
    expect(copy.learn).toContain("I learn how you work, one task at a time");
    expect(
      assistantIdeas("DAM").map((idea) => `${idea.label}: ${idea.text}`),
    ).not.toContain(copy.placeholder);
  });

  // TEST_SCENARIO: the composer under the greeting hints a message to the assistant by name, as the design does, never one of the ideas whose pill already says it.
  it("hints a message to the assistant by name", () => {
    expect(copy.placeholder).toBe("Message Dammy");
  });

  // TEST_SCENARIO: the sentence beside the provider names where to change it, once, in the design's words.
  it("points at Agent settings in the design's words", () => {
    expect(copy.settingsPrefix).toBe("You can switch providers anytime in");
    expect(copy.settingsLink).toBe("Agent settings");
  });

  // TEST_SCENARIO: the provider line names CurveBender only when that is the provider the Agent runs on, and otherwise points at where it changes without naming one.
  it("names the provider it has, and no other", () => {
    expect(copy.provider).toContain("CurveBender");
    const other = greetingCopy({
      firstName: "Jenna",
      assistantName: "Dammy",
      brandName: "DAM",
      provider: "other",
    });
    expect(other.provider).toBe("");
    expect(other.provider).not.toContain("CurveBender");
    expect(providerLineFor("curve-bender-deployment")).toBe("curve-bender");
    expect(providerLineFor("curve-bender")).toBe("curve-bender");
    expect(providerLineFor("anthropic")).toBe("other");
    expect(providerLineFor(undefined)).toBeNull();
  });

  // TEST_SCENARIO: the Agent holds an app Connection too, listed before its provider: only the provider Connections decide the line, in the order the person set — preferred first, else the first — so a GitHub grant never hides the provider, nor speaks for it.
  it("reads the provider from provider Connections alone", () => {
    const grant = (
      templateId: string,
      preferred = false,
    ): { preferred: boolean; connection: { templateId: string } } => ({
      preferred,
      connection: { templateId },
    });
    expect(
      preferredProviderTemplate({
        connections: [grant("github"), grant("anthropic", true)],
      }),
    ).toBe("anthropic");
    expect(
      preferredProviderTemplate({
        connections: [grant("github"), grant("curve-bender")],
      }),
    ).toBe("curve-bender");
    expect(
      preferredProviderTemplate({ connections: [grant("github")] }),
    ).toBeUndefined();
    expect(
      preferredProviderTemplate({
        connections: [{ preferred: true }],
      }),
    ).toBeUndefined();
    expect(preferredProviderTemplate(undefined)).toBeUndefined();
  });
});

describe("the record's used mark", () => {
  // TEST_SCENARIO: the first Session of the chat appears before the api-server has learned of it, so the cached record learns it here — and the greeting's own gate then stays shut for a New chat in the same page load.
  it("closes the gate the moment a session exists", () => {
    const key = trpc.assistants.state.queryKey();
    const row = {
      agentId: ASSISTANT,
      used: false,
      resetAt: null,
      ready: true,
    };
    queryClient.setQueryData(key, row);
    markAssistantUsed(ASSISTANT);
    expect(queryClient.getQueryData(key)).toEqual({ ...row, used: true });
    expect(
      greetingShown({
        ...ON,
        used: queryClient.getQueryData<typeof row>(key)?.used,
      }),
    ).toBe(false);
  });

  // TEST_SCENARIO: a session on another Agent is not the assistant's, so a record that does not name it is left alone.
  it("leaves a record that names another agent alone", () => {
    const key = trpc.assistants.state.queryKey();
    const row = {
      agentId: ASSISTANT,
      used: false,
      resetAt: null,
      ready: true,
    };
    queryClient.setQueryData(key, row);
    markAssistantUsed("agent-2");
    expect(queryClient.getQueryData(key)).toEqual(row);
  });
});

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let picked: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useStore.setState({ drafts: {}, messages: [] });
  picked = vi.fn<() => void>();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      createElement(AssistantGreeting, {
        greeting: copy,
        avatar: null,
        agentId: ASSISTANT,
        sessionId: null,
        onConfigure: () => {},
        onPicked: picked,
      }),
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useStore.setState({ drafts: {}, messages: [] });
  vi.unstubAllGlobals();
});

describe("the greeting in the chat", () => {
  // TEST_SCENARIO: the greeting is shown with the assistant's own name above it and one pill per idea it offers, each labelled.
  it("shows the assistant above the message, one pill per idea", () => {
    expect(host.textContent).toContain("Dammy");
    expect(host.textContent).toContain(copy.opening);
    const pills = [...host.querySelectorAll("button")].filter((button) =>
      assistantIdeas("DAM").some((idea) =>
        button.textContent?.includes(idea.text),
      ),
    );
    expect(pills).toHaveLength(assistantIdeas("DAM").length);
    expect(
      host.querySelector('[data-testid="assistant-greeting-settings"]'),
    ).not.toBeNull();
  });

  // TEST_SCENARIO: a click on a pill puts its labelled text in the composer of this chat and stops there, so nothing runs before the person acts.
  it("fills the composer without sending", () => {
    const task = `${assistantIdeas("DAM")[0]!.label}: ${assistantIdeas("DAM")[0]!.text}`;
    const chip = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes(assistantIdeas("DAM")[0]!.text),
    );
    expect(chip).toBeDefined();
    act(() => chip!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(useStore.getState().drafts[draftKey(ASSISTANT, null)]?.text).toBe(
      task,
    );
    expect(useStore.getState().messages).toEqual([]);
    expect(picked).toHaveBeenCalledOnce();
  });
});
