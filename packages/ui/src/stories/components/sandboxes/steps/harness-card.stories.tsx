import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { HarnessCard } from "@/modules/sandboxes/components/steps/harness-card";

import { loadTemplates } from "../load";

type Args = Omit<ComponentProps<typeof HarnessCard>, "template">;

const loadHarnesses = async () => ({ templates: await loadTemplates() });
type Loaded = Awaited<ReturnType<typeof loadHarnesses>>;

const byId = (loaded: unknown, id: string) => {
  const found = (loaded as Loaded).templates.find((t) => t.id === id);
  if (!found) throw new Error(`fixture template ${id} missing`);
  return found;
};

const meta = {
  title: "Components/Sandboxes/Steps/HarnessCard",
  parameters: { layout: "padded" },
  loaders: [loadHarnesses],
  args: { selected: false, onSelect: fn() },
  render: (args, { loaded }) => (
    <div className="max-w-sm">
      <HarnessCard {...args} template={byId(loaded, "claude-code")} />
    </div>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Selected: Story = { args: { selected: true } };

/** Codex has no bundled icon, so it falls back to the OpenAI provider icon. */
export const ProviderIcon: Story = {
  render: (args, { loaded }) => (
    <div className="max-w-sm">
      <HarnessCard {...args} template={byId(loaded, "codex")} />
    </div>
  ),
};

/** No fixture harness is experimental; this flips the flag on Claude Code to
 *  show the Alpha badge. */
export const Experimental: Story = {
  render: (args, { loaded }) => (
    <div className="max-w-sm">
      <HarnessCard
        {...args}
        template={{ ...byId(loaded, "claude-code"), experimental: true }}
      />
    </div>
  ),
};

/** Every harness the install serves, side by side. */
export const Catalogue: Story = {
  render: (args, { loaded }) => (
    <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
      {(loaded as Loaded).templates.map((t) => (
        <HarnessCard key={t.id} {...args} template={t} />
      ))}
    </div>
  ),
};
