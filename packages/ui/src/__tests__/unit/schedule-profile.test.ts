// TEST_OVERVIEW: A schedule runs on a profile (D92): what a new one (or a new channel, D91) starts on, the one field that picks it, what a save sends, and the custom pickers that stand in for a schedule written before profiles.
import type { ProfileWithUsage } from "api-server-api";
import { createElement, Fragment, type PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultProfileId } from "../../modules/profiles/lib/default-profile.js";
import { ScheduleDetails } from "../../modules/schedules/components/schedule-details.js";
import { ScheduleChoicesField } from "../../modules/schedules/forms/schedule-fields.js";
import {
  customChoiceError,
  quietHoursChange,
  scheduleChoices,
  scheduleFields,
  scheduleInheritsChoices,
  scheduleSlots,
} from "../../modules/schedules/forms/schedule-form-schema.js";
import type { Schedule } from "../../types.js";

const state = vi.hoisted(() => ({
  profiles: [] as ProfileWithUsage[],
  fallback: undefined as
    | {
        harness: string;
        provider: null;
        model: string;
        settings: Record<string, string>;
      }
    | undefined,
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

vi.mock("../../modules/sessions/components/session-pair-picker.js", () => ({
  SessionPairPicker: (props: {
    target?: { slots: unknown; label: string; placeholder: string };
  }) =>
    createElement(
      "output",
      { "data-picker": props.target?.label },
      JSON.stringify(props.target?.slots),
    ),
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (store: unknown) => unknown) =>
    select({ showConfirm: vi.fn(), navigateToSandboxHome: vi.fn() }),
}));

vi.mock("../../modules/profiles/api/queries.js", () => ({
  useProfiles: () => ({ data: state.profiles }),
}));

vi.mock("../../modules/profiles/hooks/use-profile-attach.js", () => ({
  useProfileAttach: () => ({
    attach: async () => "conn-attached",
    manage: () => {},
  }),
}));

vi.mock("../../modules/agents/hooks/use-operable-state.js", () => ({
  useOperableState: () => ({ operable: state.operable, comingUp: false }),
}));

vi.mock("../../modules/agents/hooks/use-wake-agent.js", () => ({
  useWakeAgent: () => ({ wake: vi.fn(), isPending: false }),
}));

vi.mock("@/components/ui/tooltip", () => ({
  HintTooltip: ({ children }: PropsWithChildren) => children,
  Tooltip: ({ children }: PropsWithChildren) => children,
}));

vi.mock("../../modules/agents/api/harness-config.js", () => ({
  useHarnessConfigStatus: () => ({
    data: {
      modelRouter: state.routed,
      harnesses: [
        {
          name: "claude-code",
          sessionSettings: ["effort"],
          harnessConfigCatalog: {
            options: [
              {
                id: "effort",
                name: "Effort",
                category: "thought_level",
                default: "medium",
                choices: [
                  { value: "low", name: "low" },
                  { value: "medium", name: "medium" },
                ],
              },
            ],
          },
        },
      ],
      defaultHarness: "claude-code",
    },
  }),
}));

vi.mock("../../modules/agents/api/queries.js", () => ({
  useIsAgentOperable: () => state.operable,
}));

vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  useHarnessCatalog: () => ({ data: { harnesses: [] } }),
  useHarnessCatalogModels: () => ({ data: undefined, granted: [] }),
  useHarnessConfigured: () => undefined,
  useGrantProvider: () => ({ grant: vi.fn(), pending: false }),
  useProviderConnections: () => ({
    granted: [],
    owned: [{ id: "conn-b", name: "AWS Bedrock", type: "bedrock" }],
  }),
  useSessionDefaults: () => ({
    data: { chat: null, channel: null, scheduled: null },
  }),
}));

vi.mock("../../modules/schedules/api/session-model.js", () => ({
  useHasHarnessDefault: () => false,
  useScheduleDefault: () => ({ data: state.fallback }),
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
  newAgentDefault: true,
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
  platformSubagentProfile: string;
}

function Field({
  profile: value,
  inheritChoice = false,
}: {
  profile: string;
  inheritChoice?: boolean;
}) {
  const { control } = useForm<Choices>({
    defaultValues: {
      harness: "",
      model: "",
      settings: {},
      profile: value,
      platformSubagentProfile: "",
    },
  });
  return createElement(ScheduleChoicesField<Choices>, {
    agentId: "a1",
    control,
    migrationNote: null,
    inheritChoice,
  });
}

beforeEach(() => {
  state.profiles = [];
  state.routed = true;
  state.operable = true;
});

describe("what a new schedule or channel starts on", () => {
  /** TEST_SCENARIO: the newest sibling's profile wins over the chat profile; one the owner no longer holds is passed over, and with none left the owner's default for new agents answers. */
  it("takes the newest sibling's profile, then the chat profile, then the default for new agents", () => {
    const profiles = [profile(), profile({ id: "p2", newAgentDefault: false })];
    expect(defaultProfileId(profiles, ["p2", "p1"])).toBe("p2");
    expect(defaultProfileId(profiles, ["gone", "p2"])).toBe("p2");
    expect(defaultProfileId(profiles, [null, undefined])).toBe("p1");
    expect(defaultProfileId([], ["gone"])).toBe(null);
  });
});

describe("what a schedule save sends", () => {
  /** TEST_SCENARIO: a schedule on a profile sends the profile with only the subagent's own values beside it, so the values the form shows, which the profile resolves to, are never taken for a detach; a custom one sends its own values and clears the profile; the subagent reference is always named; a recurring update clears an emptied choice with null. */
  it("sends the profile alone, or the values with the profile cleared", () => {
    const subagent = {
      "platformSubagent.harness": "pi",
      "platformSubagent.model": "cb/haiku",
    };
    const values = {
      harness: "claude-code",
      model: "cb/x",
      settings: { effort: "high", mode: "", ...subagent },
    };
    expect(scheduleChoices({ ...values, profile: "p1" }, true)).toEqual({
      profile: "p1",
      platformSubagentProfile: null,
      settings: subagent,
    });
    expect(
      scheduleChoices(
        { ...values, profile: "p1", platformSubagentProfile: "p2" },
        true,
      ),
    ).toEqual({ profile: "p1", platformSubagentProfile: "p2" });
    expect(scheduleChoices({ ...values, profile: "" }, false)).toEqual({
      profile: null,
      platformSubagentProfile: null,
      harness: "claude-code",
      model: "cb/x",
      settings: { effort: "high", ...subagent },
    });
    expect(
      scheduleChoices(
        { profile: "", harness: "codex", model: "", settings: {} },
        true,
      ),
    ).toEqual({
      profile: null,
      platformSubagentProfile: null,
      harness: "codex",
      model: null,
      settings: null,
    });
  });

  /** TEST_SCENARIO: the form's fields read as the chat default's two slots for the picker, and a pick's slots go back into the same fields, both slots kept. */
  it("maps the form's fields to the picker's slots and back", () => {
    const subagent = {
      "platformSubagent.harness": "pi",
      "platformSubagent.model": "cb/haiku",
    };
    const fields = {
      profile: "",
      harness: "codex",
      model: "openai/gpt-5.5",
      settings: { effort: "high", ...subagent },
      platformSubagentProfile: "",
    };
    const slots = scheduleSlots(fields);
    expect(slots).toEqual({
      profileId: null,
      pair: {
        harness: "codex",
        provider: null,
        model: "openai/gpt-5.5",
        settings: { effort: "high" },
      },
      platformSubagentProfileId: null,
      platformSubagentSettings: subagent,
    });
    expect(
      scheduleFields(slots, {
        harness: "codex",
        provider: null,
        model: "openai/gpt-5.5",
        settings: { effort: "high", ...subagent },
      }),
    ).toEqual(fields);
    expect(
      scheduleSlots({
        ...fields,
        profile: "p1",
        platformSubagentProfile: "p2",
      }),
    ).toMatchObject({
      profileId: "p1",
      pair: null,
      platformSubagentProfileId: "p2",
      platformSubagentSettings: null,
    });
  });
});

describe("what a schedule edit sends for quiet hours", () => {
  const night = { startTime: "22:00", endTime: "07:00", enabled: true };
  const lunch = { startTime: "12:00", endTime: "13:00", enabled: true };
  /** TEST_SCENARIO: removing a quiet-hours row and saving sends the shorter list; an untouched list is not sent, and an emptied one is sent empty, which clears the stored hours. */
  it("sends the rows only when they changed", () => {
    const stored = { quietHours: [night, lunch] };
    expect(quietHoursChange({ quietHours: [night] }, stored)).toEqual({
      quietHours: [night],
    });
    expect(
      quietHoursChange({ quietHours: [{ ...night }, { ...lunch }] }, stored),
    ).toEqual({});
    expect(quietHoursChange({ quietHours: [] }, stored)).toEqual({
      quietHours: [],
    });
  });
});

describe("the schedule form's Runs on field", () => {
  /** TEST_SCENARIO: the field is the chat's own picker, given the schedule's two slots (QA unification): a profile primary names the profile, and values of its own make the custom pair. */
  it("hands the chat picker the schedule's slots", () => {
    state.profiles = [profile()];
    const onProfile = renderToStaticMarkup(
      createElement(Field, { profile: "p1" }),
    );
    expect(onProfile).toContain('data-picker="Schedule harness and model"');
    expect(onProfile).toContain("&quot;profileId&quot;:&quot;p1&quot;");
  });

  /** TEST_SCENARIO: a schedule written before profiles that follows the
   * agent's chat default says so, which is what its empty values mean now
   * that nothing writes a scheduled default (D90/D92), and names the default
   * in the one summary; a new one does not offer it (D123). */
  it("names the empty choice the agent's chat default, only where it is the row's own", () => {
    state.profiles = [profile()];
    state.fallback = {
      harness: "claude-code",
      provider: null,
      model: "bedrock/fable",
      settings: { effort: "low" },
    };
    const follows = renderToStaticMarkup(
      createElement(Field, { profile: "", inheritChoice: true }),
    );
    state.fallback = undefined;
    expect(follows).toContain("fable · Low (AWS Bedrock)");
    expect(follows).toContain("follows the agent&#x27;s chat default");
    expect(follows).not.toContain("Scheduled default");
    expect(
      renderToStaticMarkup(createElement(Field, { profile: "" })),
    ).not.toContain("follows the agent");
  });
});

describe("a Custom selection without a model", () => {
  /** TEST_SCENARIO: a new schedule, or one with its own harness, cannot save a Custom selection that names no model, so it never silently follows the chat default (QA N1, D123); a profile, a model, a row written before profiles that still follows, and a runtime without the Model Router save as before. */
  it("refuses to save unless the row already follows the chat default", () => {
    const empty = { profile: "", harness: "claude-code", model: "" };
    expect(customChoiceError(empty, undefined, true)).toMatch(/Pick a model/);
    expect(
      customChoiceError({ ...empty, profile: "p1" }, undefined, true),
    ).toBe(null);
    expect(
      customChoiceError({ ...empty, model: "bedrock/opus" }, undefined, true),
    ).toBe(null);
    expect(customChoiceError(empty, undefined, false)).toBe(null);
    const legacy = schedule(null);
    expect(customChoiceError({ ...empty, harness: "" }, legacy, true)).toBe(
      null,
    );
    expect(customChoiceError(empty, legacy, true)).toMatch(/Pick a model/);
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

describe("what a schedule's details say it runs on", () => {
  /** TEST_SCENARIO: a profile that cannot run shows the server's reason and never the chat default it would not fall back to; a healthy custom choice reads the same model, effort and provider as the schedule's row and the picker, which share the one summary (unification item 2). */
  it("shows the profile's issue, or the one summary of its own values", () => {
    state.profiles = [profile()];
    state.fallback = {
      harness: "claude-code",
      provider: null,
      model: "bedrock/fable",
      settings: { effort: "low" },
    };
    try {
      const broken = renderToStaticMarkup(
        createElement(ScheduleDetails, {
          schedule: {
            ...schedule("p1"),
            profileIssue: "Its provider is no longer attached.",
          },
        }),
      );
      expect(broken).toContain("Its provider is no longer attached.");
      expect(broken).not.toContain("chat default");
      expect(broken).not.toContain("fable");
      const custom = renderToStaticMarkup(
        createElement(ScheduleDetails, {
          schedule: {
            ...schedule(null),
            harness: "claude-code",
            model: "bedrock/fable",
            settings: { effort: "low" },
          },
        }),
      );
      expect(custom).toContain("fable · Low (AWS Bedrock)");
      expect(custom).not.toContain("chat default");
    } finally {
      state.fallback = undefined;
    }
  });
});
