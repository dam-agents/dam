// TEST_OVERVIEW: A schedule runs on a profile (D92): what a new one (or a new channel, D91) starts on, the one field that picks it, what a save sends, and the custom pickers that stand in for a schedule written before profiles.
import type { ProfileWithUsage } from "api-server-api";
import { createElement, Fragment, type PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultProfileId } from "../../modules/profiles/lib/default-profile.js";
import { ScheduleChoicesField } from "../../modules/schedules/forms/schedule-fields.js";
import {
  scheduleChoices,
  scheduleInheritsChoices,
} from "../../modules/schedules/forms/schedule-form-schema.js";
import type { Schedule } from "../../types.js";

const state = vi.hoisted(() => ({
  profiles: [] as ProfileWithUsage[],
  routed: true,
  operable: true,
}));

vi.mock("@/components/ui/popover", () => {
  const passthrough = ({ children }: PropsWithChildren) =>
    createElement(Fragment, null, children);
  return {
    Popover: passthrough,
    PopoverTrigger: passthrough,
    PopoverContent: passthrough,
  };
});

vi.mock("../../modules/profiles/api/queries.js", () => ({
  useProfiles: () => ({ data: state.profiles }),
}));

vi.mock("../../modules/profiles/hooks/use-profile-attach.js", () => ({
  useProfileAttach: () => ({ attach: async () => true, manage: () => {} }),
}));

vi.mock("../../modules/agents/hooks/use-operable-state.js", () => ({
  useOperableState: () => ({ operable: state.operable, comingUp: false }),
}));

vi.mock("../../modules/agents/hooks/use-wake-agent.js", () => ({
  useWakeAgent: () => ({ wake: vi.fn(), isPending: false }),
}));

vi.mock("@/components/ui/tooltip", () => ({
  HintTooltip: ({ children }: PropsWithChildren) => children,
}));

vi.mock("../../modules/agents/api/harness-config.js", () => ({
  useHarnessConfigStatus: () => ({
    data: {
      modelRouter: state.routed,
      harnesses: [{ name: "claude-code", sessionSettings: ["effort"] }],
      defaultHarness: "claude-code",
    },
  }),
}));

vi.mock("../../modules/agents/api/queries.js", () => ({
  useIsAgentOperable: () => state.operable,
}));

vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  useHarnessCatalog: () => ({ data: { harnesses: [] } }),
  useHarnessCatalogModels: () => ({ data: [], granted: [] }),
  useHarnessConfigured: () => undefined,
  useProviderConnections: () => ({ granted: [] }),
  useSessionDefaults: () => ({
    data: { chat: null, channel: null, scheduled: null },
  }),
}));

vi.mock("../../modules/schedules/api/session-model.js", () => ({
  useHasHarnessDefault: () => false,
  useScheduleDefault: () => ({ data: undefined }),
  useSessionModelChoices: () => [],
}));

const profile = (
  overrides: Partial<ProfileWithUsage> = {},
): ProfileWithUsage => ({
  id: "p1",
  name: "Default",
  harness: "claude-code",
  providerTemplate: "curve-bender-deployment",
  model: "cb/rits/deepseek-ai/DeepSeek-V4.1-Flash-1017",
  settings: {},
  seeded: true,
  usage: { agents: 0, channels: 0, schedules: 0 },
  availability: { available: true, reason: null, attachable: false },
  ...overrides,
});

const schedule = (profileId: string | null): Schedule =>
  ({
    id: `s-${profileId ?? "custom"}`,
    name: "Daily brief",
    agentId: "a1",
    type: "rrule",
    cron: null,
    rrule: "FREQ=DAILY",
    at: null,
    inSession: null,
    harness: null,
    model: null,
    settings: null,
    profile: profileId,
    migrationNote: null,
    sessionTitle: null,
    timezone: "UTC",
    quietHours: [],
    task: "Go",
    precheck: null,
    enabled: true,
    createdBy: "user",
    status: null,
  }) as Schedule;

interface Choices {
  harness: string;
  model: string;
  settings: Record<string, string>;
  profile: string;
}

function Field({ profile: value }: { profile: string }) {
  const { control } = useForm<Choices>({
    defaultValues: { harness: "", model: "", settings: {}, profile: value },
  });
  return createElement(ScheduleChoicesField<Choices>, {
    agentId: "a1",
    control,
    migrationNote: null,
  });
}

beforeEach(() => {
  state.profiles = [];
  state.routed = true;
  state.operable = true;
});

describe("what a new schedule or channel starts on", () => {
  /** TEST_SCENARIO: the newest sibling's profile wins over the chat profile; one the owner no longer holds is passed over, and with none left the seeded Default answers. */
  it("takes the newest sibling's profile, then the chat profile, then Default", () => {
    const profiles = [profile(), profile({ id: "p2", seeded: false })];
    expect(defaultProfileId(profiles, ["p2", "p1"])).toBe("p2");
    expect(defaultProfileId(profiles, ["gone", "p2"])).toBe("p2");
    expect(defaultProfileId(profiles, [null, undefined])).toBe("p1");
    expect(defaultProfileId([], ["gone"])).toBe(null);
  });
});

describe("what a schedule save sends", () => {
  /** TEST_SCENARIO: a schedule on a profile sends the profile alone, so the values the form shows, which the profile resolves to, are never taken for a detach; a custom one sends its own values and clears the profile. */
  it("sends the profile alone, or the values with the profile cleared", () => {
    const values = {
      harness: "claude-code",
      model: "cb/x",
      settings: { effort: "high", mode: "" },
    };
    expect(scheduleChoices({ ...values, profile: "p1" })).toEqual({
      profile: "p1",
    });
    expect(scheduleChoices({ ...values, profile: "" })).toEqual({
      profile: null,
      harness: "claude-code",
      model: "cb/x",
      settings: { effort: "high" },
    });
  });
});

describe("the schedule form's Profile field", () => {
  /** TEST_SCENARIO: a schedule on a profile shows the profile and no pickers of its own. */
  it("shows one profile field and hides the custom pickers", () => {
    state.profiles = [profile()];
    const html = renderToStaticMarkup(createElement(Field, { profile: "p1" }));
    expect(html).toContain("Profile");
    expect(html).toContain("Default");
    expect(html).not.toContain("Harness");
  });

  /** TEST_SCENARIO: a schedule with its own values reads as a custom selection, and the pickers it needs are there. */
  it("reads a schedule of its own values as Custom selection", () => {
    state.profiles = [profile()];
    const html = renderToStaticMarkup(createElement(Field, { profile: "" }));
    expect(html).toContain("Custom selection");
    expect(html).toContain("Harness");
  });

  /** TEST_SCENARIO: a schedule of its own values leaves them at the agent's chat
   * default, which is what an empty choice means now that nothing writes a
   * scheduled default (D90/D92). */
  it("names the empty choice the agent's chat default, not a scheduled default", () => {
    state.profiles = [profile()];
    const html = renderToStaticMarkup(createElement(Field, { profile: "" }));
    expect(html).toContain("The agent&#x27;s chat default");
    expect(html).not.toContain("Scheduled default");
  });

  /** TEST_SCENARIO: an install with no profile at all keeps the pickers alone, so nothing new blocks a schedule. */
  it("leaves the pickers alone when the owner has no profile", () => {
    const html = renderToStaticMarkup(createElement(Field, { profile: "" }));
    expect(html).toContain("Harness");
    expect(html).not.toContain("Custom selection");
  });
});

describe("the chat default choice on Custom selection", () => {
  /** TEST_SCENARIO: the empty choice stays only for a schedule written before profiles that follows the chat default, so such a row opens and saves untouched; a row with a harness or a profile asks for concrete values (D123). */
  it("keeps the empty choice only for a schedule that inherits", () => {
    expect(scheduleInheritsChoices(schedule(null))).toBe(true);
    expect(scheduleInheritsChoices(undefined)).toBe(false);
    expect(
      scheduleInheritsChoices({
        ...schedule(null),
        harness: "codex",
      } as Schedule),
    ).toBe(false);
    expect(scheduleInheritsChoices(schedule("p1"))).toBe(false);
  });
});
