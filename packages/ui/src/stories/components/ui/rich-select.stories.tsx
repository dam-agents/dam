import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import { Badge } from "@/components/ui/badge";
import { RichSelect, type RichSelectOption } from "@/components/ui/rich-select";
import { CardIcon } from "@/modules/providers/components/card-icon";
import { PROVIDER_ROWS } from "@/modules/providers/lib/provider-rows";
import { type ProviderPresetType, PROVIDERS } from "@/types";

const CONNECTED = new Set<ProviderPresetType>(["anthropic"]);

const OPTIONS: RichSelectOption<ProviderPresetType>[] = PROVIDER_ROWS.map(
  (row) => ({
    value: row.type,
    title: PROVIDERS[row.type].displayName,
    description: row.description,
    icon: <CardIcon provider={row.type} size="sm" />,
    triggerIcon: <CardIcon provider={row.type} />,
    badge:
      row.type === "anthropic" ? (
        <Badge variant="muted">Recommended</Badge>
      ) : undefined,
    triggerBadge: CONNECTED.has(row.type) ? (
      <Badge variant="success">Connected</Badge>
    ) : undefined,
    trailing: CONNECTED.has(row.type) ? undefined : (
      <span className="shrink-0 text-sm text-muted-foreground">Connect</span>
    ),
  }),
);

const openMenu = ({ canvasElement }: { canvasElement: HTMLElement }) => {
  canvasElement.querySelector("button")?.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerType: "mouse",
    }),
  );
};

const meta = {
  title: "Components/UI/RichSelect",
  component: RichSelect<ProviderPresetType>,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-xl pb-96">
        <Story />
      </div>
    ),
  ],
  args: {
    options: OPTIONS,
    value: "anthropic",
    onSelect: fn(),
    placeholder: "Select a provider",
    ariaLabel: "Provider",
    disabled: false,
    invalid: false,
  },
  argTypes: {
    value: {
      control: "select",
      options: [null, ...PROVIDER_ROWS.map((row) => row.type)],
    },
    options: { control: false },
    disabled: { control: "boolean" },
    invalid: { control: "boolean" },
  },
} satisfies Meta<typeof RichSelect<ProviderPresetType>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Selected: Story = {};

export const Placeholder: Story = { args: { value: null } };

export const Invalid: Story = { args: { value: null, invalid: true } };

export const Disabled: Story = { args: { disabled: true } };

export const Open: Story = { play: openMenu };

export const Interactive: Story = {
  render: function Interactive(args) {
    const [value, setValue] = useState<ProviderPresetType | null>(null);
    return <RichSelect {...args} value={value} onSelect={setValue} />;
  },
};
