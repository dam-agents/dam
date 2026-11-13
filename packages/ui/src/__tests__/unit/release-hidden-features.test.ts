// @vitest-environment happy-dom
// TEST_OVERVIEW: two surfaces stay behind experimental features, off by default. With chat-network-approvals off, an agent's waiting network approval does not show above the message box of its open conversation; with it on, it does. With one-time-tasks off, the schedule form offers no Repeat / Once choice and opens the recurring form, and a one-time task an agent or the API made stays in the list as a row whose editor never opens; with it on, the choice is back and a pending one-time task opens in its own editor.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scheduleLockNotice } from "../../modules/schedules/components/schedule-lock-notice.js";
import { scheduleLock } from "../../modules/schedules/lib/schedule-lock.js";
import type { Schedule } from "../../types.js";

const fake = vi.hoisted(() => ({
  flags: {} as Record<string, boolean>,
}));

vi.mock("../../modules/features/api/queries.js", () => ({
  useFeatures: () => ({ data: fake.flags }),
}));
vi.mock("../../modules/sessions/components/egress-approval-prompt.js", () => ({
  EgressApprovalPrompt: () =>
    createElement("div", { "data-testid": "chat-egress-approval" }),
}));
vi.mock("../../modules/sessions/components/chat-input.js", () => ({
  ChatInput: () => createElement("textarea", { "data-testid": "chat-input" }),
}));
vi.mock("../../modules/invocations/components/owner-question-prompt.js", () => ({
  OwnerQuestionPrompt: () => null,
  PostponedQuestionsLine: () => null,
}));
vi.mock("../../modules/invocations/hooks/use-owner-question-queue.js", () => ({
  questionKey: () => "q",
  useOwnerQuestionQueue: () => ({
    current: null,
    more: 0,
    postponed: [],
    later: () => {},
    answered: () => {},
    resume: () => {},
  }),
}));
vi.mock("../../modules/schedules/forms/recurring-schedule-form.js", () => ({
  RecurringScheduleForm: ({ leadingFields }: { leadingFields?: ReactNode }) =>
    createElement("div", { "data-testid": "recurring-form" }, leadingFields),
}));
vi.mock("../../modules/schedules/forms/once-schedule-form.js", () => ({
  OnceScheduleForm: ({ leadingFields }: { leadingFields?: ReactNode }) =>
    createElement("div", { "data-testid": "once-form" }, leadingFields),
}));

const { ChatInputArea } =
  await import("../../modules/sessions/components/chat-input-area.js");
const { ScheduleFormModal } =
  await import("../../modules/schedules/forms/schedule-form-modal.js");

const onceTask: Schedule = {
  id: "s-once",
  name: "Check back on the deploy",
  agentId: "agent-1",
  type: "once",
  cron: null,
  rrule: null,
  timezone: "Europe/Prague",
  quietHours: [],
  task: "See whether the deploy finished",
  precheck: null,
  enabled: true,
  sessionMode: "fresh",
  createdBy: "agent",
  status: null,
  at: "2026-11-20T09:00:00Z",
  inSession: null,
  harness: null,
  model: null,
  settings: null,
  profile: null,
  migrationNote: null,
  sessionTitle: null,
};

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.flags = {};
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

const byTestId = (id: string) =>
  document.body.querySelector(`[data-testid="${id}"]`);

function renderChatInput() {
  act(() =>
    root.render(
      createElement(ChatInputArea, {
        channelLive: true,
      } as Parameters<typeof ChatInputArea>[0]),
    ),
  );
}

function renderScheduleForm(existing?: Schedule) {
  act(() =>
    root.render(
      createElement(ScheduleFormModal, {
        agentId: "agent-1",
        onClose: () => {},
        ...(existing ? { existing } : {}),
      }),
    ),
  );
}

describe("network approvals in the chat", () => {
  // TEST_SCENARIO: a person who has not turned the feature on sees only the message box, as on 0.2.x; the approval waits in the approvals list and the notifications.
  it("shows no approval above the message box with the feature off", () => {
    renderChatInput();
    expect(byTestId("chat-input")).not.toBeNull();
    expect(byTestId("chat-egress-approval")).toBeNull();
  });

  // TEST_SCENARIO: a person who turned it on in Experimental features answers the approval in the chat.
  it("shows the waiting approval above the message box with the feature on", () => {
    fake.flags = { "chat-network-approvals": true };
    renderChatInput();
    expect(byTestId("chat-egress-approval")).not.toBeNull();
    expect(byTestId("chat-input")).not.toBeNull();
  });
});

describe("one-time tasks in the schedule form", () => {
  // TEST_SCENARIO: a new schedule with the feature off opens the recurring form with no Repeat / Once choice.
  it("offers no Once choice with the feature off", () => {
    renderScheduleForm();
    expect(byTestId("recurring-form")).not.toBeNull();
    expect(byTestId("once-form")).toBeNull();
    expect(document.body.querySelector('[aria-label="Runs"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Once");
  });

  // TEST_SCENARIO: with the feature on, the choice is back above the recurring form.
  it("offers the Repeat / Once choice with the feature on", () => {
    fake.flags = { "one-time-tasks": true };
    renderScheduleForm();
    expect(byTestId("recurring-form")).not.toBeNull();
    expect(document.body.querySelector('[aria-label="Runs"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Once");
  });

  // TEST_SCENARIO: with the feature on, a pending one-time task opens in the one-time editor.
  it("edits a pending one-time task in its own editor with the feature on", () => {
    fake.flags = { "one-time-tasks": true };
    renderScheduleForm({ ...onceTask, createdBy: "user" });
    expect(byTestId("once-form")).not.toBeNull();
  });
});

describe("a one-time task in the schedules list", () => {
  // TEST_SCENARIO: with the feature off, a one-time task an agent or the API made is locked: its editor never opens, and the notice says to delete it and ask the agent for a new one.
  it("locks every one-time task with the feature off", () => {
    expect(scheduleLock(onceTask, false)).toBe("runs-once");
    expect(scheduleLock({ ...onceTask, createdBy: "user" }, false)).toBe(
      "runs-once",
    );
    const notice = scheduleLockNotice("runs-once", "Builder");
    expect(notice.title).toBe("This schedule runs once");
    expect(notice.action).toBeUndefined();
  });

  // TEST_SCENARIO: with the feature on, a user's pending one-time task opens as before, and an agent's stays the agent's to change.
  it("leaves a pending one-time task editable with the feature on", () => {
    expect(scheduleLock({ ...onceTask, createdBy: "user" }, true)).toBeNull();
    expect(scheduleLock(onceTask, true)).toBe("agent-managed");
  });

  // TEST_SCENARIO: the feature never locks a recurring schedule.
  it("does not lock a recurring schedule either way", () => {
    const recurring: Schedule = {
      ...onceTask,
      type: "rrule",
      rrule: "FREQ=DAILY",
      at: null,
      createdBy: "user",
    };
    expect(scheduleLock(recurring, false)).toBeNull();
    expect(scheduleLock(recurring, true)).toBeNull();
  });
});
