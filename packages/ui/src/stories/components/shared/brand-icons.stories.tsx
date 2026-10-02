import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  AnthropicIcon,
  BobIcon,
  GithubIcon,
  LiteLLMIcon,
  OpenAIIcon,
} from "@/components/brand-icons";

const meta = {
  title: "Components/Shared/BrandIcons",
  component: GithubIcon,
  parameters: { layout: "centered" },
  args: { className: "size-4" },
} satisfies Meta<typeof GithubIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Github: Story = {};
export const Anthropic: Story = {
  render: (args) => <AnthropicIcon {...args} />,
};
export const OpenAI: Story = { render: (args) => <OpenAIIcon {...args} /> };
export const Bob: Story = { render: (args) => <BobIcon {...args} /> };
export const LiteLLM: Story = {
  render: (args) => <LiteLLMIcon className={args.className} />,
};

/** Every provider mark side by side, as they appear in model and connection lists. */
export const All: Story = {
  render: (args) => (
    <div className="flex items-center gap-4 text-foreground">
      <GithubIcon {...args} />
      <AnthropicIcon {...args} />
      <OpenAIIcon {...args} />
      <BobIcon {...args} />
      <LiteLLMIcon className={args.className} />
    </div>
  ),
};
