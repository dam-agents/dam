// TEST_OVERVIEW: the schedule form's Model field on a sleeping agent. On a routed runtime the model list comes from the api-server's catalog, so a sleeping agent's models are listed; an agent that never reported its harnesses, and the old runtime, whose list is read from the running agent, offer to start it instead of a picker with nothing in it, and list the models once it is up.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScheduleChoicesField } from "../../modules/schedules/forms/schedule-fields.js";

const state = vi.hoisted(() => ({
  routed: true,
  operable: false,
  comingUp: false,
  harnesses: [
    {
      name: "codex",
      harnessConfig: true,
      sessionModel: true,
      sessionSettings: [],
    },
  ] as unknown[] | null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  HintTooltip: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../../modules/profiles/api/queries.js", () => ({
  useProfiles: () => ({ data: [] }),
}));

vi.mock("../../modules/profiles/hooks/use-profile-attach.js", () => ({
  useProfileAttach: () => ({
    attach: async () => "conn-attached",
    manage: () => {},
  }),
}));

vi.mock("../../modules/agents/api/harness-config.js", () => ({
  useHarnessConfigStatus: () => ({
    data: {
      modelRouter: state.routed,
      sessionModel: true,
      defaultHarness: "codex",
      harnesses: state.harnesses,
    },
  }),
}));

vi.mock("../../modules/agents/api/queries.js", () => ({
  useIsAgentOperable: () => state.operable,
}));

vi.mock("../../modules/agents/hooks/use-operable-state.js", () => ({
  useOperableState: () => ({
    operable: state.operable,
    comingUp: state.comingUp,
  }),
}));

vi.mock("../../modules/agents/hooks/use-wake-agent.js", () => ({
  useWakeAgent: () => ({ wake: vi.fn(), isPending: false }),
}));

vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  useSessionDefaults: () => ({ data: undefined }),
  useHarnessCatalog: () => ({
    data: {
      harnesses: [
        { name: "codex", displayName: "Codex", providers: ["openai"] },
      ],
    },
  }),
  useHarnessCatalogModels: () => ({
    data: state.routed
      ? {
          harness: "codex",
          routed: true,
          providers: [
            {
              connectionId: "oai",
              alias: "openai",
              template: "openai",
              displayName: "OpenAI",
              status: "listed",
              listedAt: null,
              models: [
                {
                  name: "openai/gpt-5.5",
                  upstreamId: "gpt-5.5",
                  contextWindow: null,
                  maxOutputTokens: null,
                  reasoning: null,
                  vision: null,
                  prices: null,
                  source: { limits: "none", prices: "none" },
                },
              ],
            },
          ],
        }
      : undefined,
    operable: state.operable,
  }),
  useHarnessConfigured: () => undefined,
  useProviderConnections: () => ({
    granted: [{ id: "oai", name: "OpenAI", type: "openai" }],
    owned: [],
    loaded: true,
  }),
}));

vi.mock("../../modules/schedules/api/session-model.js", () => ({
  useScheduleDefault: () => ({ data: undefined }),
  useHasHarnessDefault: () => false,
  useSessionModelChoices: () =>
    state.operable ? [{ value: "gpt-5.5", name: "GPT-5.5" }] : [],
}));

interface Choices {
  harness: string;
  model: string;
  settings: Record<string, string>;
  profile: string;
}

function Field() {
  const { control } = useForm<Choices>({
    defaultValues: { harness: "", model: "", settings: {}, profile: "" },
  });
  return createElement(ScheduleChoicesField<Choices>, {
    agentId: "agent",
    control,
    migrationNote: null,
  });
}

const render = () => renderToStaticMarkup(createElement(Field));

describe("the schedule form's model on a sleeping agent", () => {
  afterEach(() => {
    state.routed = true;
    state.operable = false;
    state.comingUp = false;
  });

  // TEST_SCENARIO: On a routed runtime the catalog needs no running agent, so a sleeping agent's schedule lists its harness and models, with no start button.
  it("lists the models of a sleeping agent on a routed runtime", () => {
    const asleep = render();
    expect(asleep).toContain('aria-label="Harness"');
    expect(asleep).toContain('aria-label="Model"');
    expect(asleep).not.toContain("Start agent to edit");
  });

  // TEST_SCENARIO: A new agent that never ran has reported no harnesses; the field still offers the start rather than a picker with nothing to pick.
  it("offers to start an agent that never ran", () => {
    state.harnesses = null;
    try {
      expect(render()).toContain("Start agent to edit");
    } finally {
      state.harnesses = [
        {
          name: "codex",
          harnessConfig: true,
          sessionModel: true,
          sessionSettings: [],
        },
      ];
    }
  });

  // TEST_SCENARIO: On a runtime without the Model Router the single model field lists the default harness's models, read from the running agent too; asleep, it offers the start instead of vanishing.
  it("offers to start the agent on a runtime without the Model Router", () => {
    state.routed = false;
    expect(render()).toContain("Start agent to edit");
    state.operable = true;
    const awake = render();
    expect(awake).toContain('aria-label="Model"');
    expect(awake).not.toContain("Start agent to edit");
  });

  // TEST_SCENARIO: Once the agent is up, the picker is back.
  it("shows the model picker once the agent is up", () => {
    state.operable = true;
    const html = render();
    expect(html).toContain('aria-label="Model"');
    expect(html).not.toContain("Start agent to edit");
  });
});
