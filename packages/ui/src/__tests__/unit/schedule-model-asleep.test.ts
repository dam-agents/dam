// TEST_OVERVIEW: the schedule form's Model field on a sleeping agent. The model list is read from the running agent, so while the agent sleeps the field offers to start it instead of a picker with nothing in it, says the agent is starting once it is woken, and lists the models once it is up.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScheduleChoicesField } from "../../modules/schedules/forms/schedule-fields.js";

const state = vi.hoisted(() => ({
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

vi.mock("../../modules/agents/api/harness-config.js", () => ({
  useHarnessConfigStatus: () => ({
    data: {
      modelRouter: true,
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
  useHarnessCatalog: () => ({
    data: {
      harnesses: [
        { name: "codex", displayName: "Codex", providers: ["openai"] },
      ],
    },
  }),
  useHarnessCatalogModels: () => ({
    data: state.operable
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
  useSessionModelChoices: () => [],
}));

function Field() {
  const { control } = useForm({
    defaultValues: { harness: "", model: "", settings: {} },
  });
  return createElement(ScheduleChoicesField, {
    agentId: "agent",
    control,
    migrationNote: null,
  });
}

const render = () => renderToStaticMarkup(createElement(Field));

describe("the schedule form's model on a sleeping agent", () => {
  afterEach(() => {
    state.operable = false;
    state.comingUp = false;
  });

  // TEST_SCENARIO: Asleep, the Model field holds the start button, not an empty picker; woken, it says the agent is starting.
  it("offers to start the agent, then says it is starting", () => {
    const asleep = render();
    expect(asleep).toContain("Start agent to edit");
    expect(asleep).not.toContain('aria-label="Model"');
    state.comingUp = true;
    const starting = render();
    expect(starting).toContain("Agent is starting…");
    expect(starting).not.toContain("Start agent to edit");
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

  // TEST_SCENARIO: Once the agent is up, the picker is back.
  it("shows the model picker once the agent is up", () => {
    state.operable = true;
    const html = render();
    expect(html).toContain('aria-label="Model"');
    expect(html).not.toContain("Start agent to edit");
  });
});
