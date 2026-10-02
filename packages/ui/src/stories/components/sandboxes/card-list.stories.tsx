import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { CardGrid, CardList } from "@/modules/sandboxes/components/card-list";
import { HarnessCard } from "@/modules/sandboxes/components/steps/harness-card";

import { loadTemplates } from "./load";

const loadHarnesses = async () => ({ templates: await loadTemplates() });
type Loaded = Awaited<ReturnType<typeof loadHarnesses>>;

/** CardList (stacked) and CardGrid (two columns from `sm`) are the inset
 *  wrappers setup uses around harness and image cards. */
const meta = {
  title: "Components/Sandboxes/CardList",
  component: CardList,
  parameters: { layout: "padded" },
  loaders: [loadHarnesses],
  args: { children: null },
} satisfies Meta<typeof CardList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = {
  render: (args, { loaded }) => (
    <div className="max-w-2xl">
      <CardList {...args}>
        {(loaded as Loaded).templates.slice(0, 2).map((t) => (
          <HarnessCard
            key={t.id}
            template={t}
            selected={false}
            onSelect={fn()}
          />
        ))}
      </CardList>
    </div>
  ),
};

export const Grid: Story = {
  render: (_args, { loaded }) => (
    <div className="max-w-3xl">
      <CardGrid>
        {(loaded as Loaded).templates.map((t) => (
          <HarnessCard
            key={t.id}
            template={t}
            selected={false}
            onSelect={fn()}
          />
        ))}
      </CardGrid>
    </div>
  ),
};
