import type { Meta, StoryObj } from "@storybook/react-vite";

import { KitRepositoryCard } from "@/modules/starter-kits/components/kit-repository-card";

import { KITS } from "../../backend/fixtures/kits";

function kit(id: string) {
  const found = KITS.find((k) => k.id === id);
  if (!found) throw new Error(`no fixture kit ${id}`);
  return found;
}

const meta = {
  title: "Components/Starter kits/KitRepositoryCard",
  component: KitRepositoryCard,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <ul className="max-w-[720px]">
        <Story />
      </ul>
    ),
  ],
  args: { kit: kit("code-guardian") },
} satisfies Meta<typeof KitRepositoryCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Seeded into the agent's home directory. */
export const SeededIntoHome: Story = {};

/** Seeded into the work directory. */
export const SeededIntoWork: Story = { args: { kit: kit("llm-wiki") } };

/** No seed repository: renders nothing. */
export const NoSeed: Story = { args: { kit: { seed: undefined } } };
