import type { Meta, StoryObj } from "@storybook/react-vite";

import { CardIcon } from "@/modules/providers/components/card-icon";
import { PROVIDER_ROWS } from "@/modules/providers/lib/provider-rows";

const meta = {
  title: "Components/Providers/CardIcon",
  component: CardIcon,
  parameters: { layout: "padded" },
  args: { provider: "anthropic", size: "md" },
  argTypes: {
    provider: {
      control: "select",
      options: PROVIDER_ROWS.map((r) => r.type),
    },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
  },
} satisfies Meta<typeof CardIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Anthropic: Story = {};
export const OpenAI: Story = { args: { provider: "openai" } };
export const IbmLitellm: Story = { args: { provider: "ibm-litellm" } };
export const Bob: Story = { args: { provider: "bob" } };

/** Every provider at every size the app uses. */
export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(["lg", "md", "sm"] as const).map((size) => (
        <div key={size} className="flex items-center gap-4">
          {PROVIDER_ROWS.map((row) => (
            <CardIcon key={row.type} provider={row.type} size={size} />
          ))}
        </div>
      ))}
    </div>
  ),
};
