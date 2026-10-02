import type { Meta, StoryObj } from "@storybook/react-vite";

import { ApiKeysList } from "@/modules/api-keys/components/api-keys-list";
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
  title: "Components/ApiKeys/ApiKeysList",
  component: ApiKeysList,
  parameters: { layout: "padded" },
  loaders: [withScenario("populated")],
  beforeEach: restoreScenario,
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ApiKeysList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {};
export const Empty: Story = { loaders: [withScenario("empty")] };
