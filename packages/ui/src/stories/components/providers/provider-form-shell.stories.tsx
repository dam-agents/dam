import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProviderFormShell } from "@/modules/providers/components/provider-form-shell";
import { PROVIDERS } from "@/types";

/** The shell every provider form renders inside; `children` is the form body. */
const meta = {
  title: "Components/Providers/ProviderFormShell",
  component: ProviderFormShell,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-[505px] rounded-xl border border-border bg-card">
        <Story />
      </div>
    ),
  ],
  args: {
    provider: "openai",
    title: PROVIDERS.openai.displayName,
    description:
      "Powers Codex agents and any harness that reads OPENAI_API_KEY.",
    onSubmit: fn((e) => e.preventDefault()),
    onCancel: fn(),
    children: (
      <div className="flex gap-3">
        <Input type="password" placeholder="sk-…" />
        <Button type="submit" className="shrink-0">
          Save
        </Button>
      </div>
    ),
  },
} satisfies Meta<typeof ProviderFormShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithCancel: Story = {};
export const WithoutCancel: Story = { args: { onCancel: undefined } };
