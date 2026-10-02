import type { Meta, StoryObj } from "@storybook/react-vite";

import { ProviderSection } from "@/modules/providers/components/provider-section";
import { queryClient } from "@/query-client";

import { type Scenario, setScenario } from "../../backend/scenario";

const withScenario = (s: Scenario) => async () => {
  setScenario(s);
  queryClient.clear();
  return {};
};

/** Restores the default scenario when the story is left, so "empty" doesn't
 *  leak into stories that never set one. */
const restoreScenario = () => () => {
  setScenario("populated");
  queryClient.clear();
};

const meta = {
  title: "Components/Providers/ProviderSection",
  component: ProviderSection,
  parameters: { layout: "padded" },
  loaders: [withScenario("populated")],
  beforeEach: restoreScenario,
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProviderSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Anthropic and OpenAI are connected in the fake backend. */
export const SomeConnected: Story = {};
export const NoneConnected: Story = { loaders: [withScenario("empty")] };
