import { Asleep, Light, Screen } from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import { CardButton } from "@/components/ui/card-button";
import { cn } from "@/lib/utils";

const THEMES = [
  {
    value: "light",
    icon: Light,
    label: "Light",
    description: "Light background with dark text",
  },
  {
    value: "dark",
    icon: Asleep,
    label: "Dark",
    description: "Dark background with light text",
  },
  {
    value: "system",
    icon: Screen,
    label: "System",
    description: "Follow your operating system setting",
  },
] as const;

const meta = {
  title: "Components/UI/CardButton",
  component: CardButton,
  parameters: { layout: "padded" },
  args: {
    selected: false,
    disabled: false,
    onClick: fn(),
    className: "flex w-72 flex-col items-start gap-2.5 p-4",
    children: (
      <span>
        <span className="block text-base font-medium leading-[1.2] text-foreground">
          Dark
        </span>
        <span className="mt-1 block text-sm text-muted-foreground">
          Dark background with light text
        </span>
      </span>
    ),
  },
  argTypes: {
    selected: { control: "boolean" },
    disabled: { control: "boolean" },
  },
} satisfies Meta<typeof CardButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Selected: Story = { args: { selected: true } };

export const Disabled: Story = { args: { disabled: true } };

export const ThemePicker: Story = {
  render: function ThemePicker() {
    const [theme, setTheme] = useState<string>("dark");
    return (
      <div className="grid max-w-3xl grid-cols-3 gap-3">
        {THEMES.map(({ value, icon: Icon, label, description }) => (
          <CardButton
            key={value}
            onClick={() => setTheme(value)}
            selected={theme === value}
            className="flex flex-col items-start gap-2.5 p-4"
          >
            <Icon
              size={22}
              className={cn(
                "shrink-0",
                theme === value ? "text-foreground" : "text-muted-foreground",
              )}
            />
            <span>
              <span className="block text-base font-medium leading-[1.2] text-foreground">
                {label}
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">
                {description}
              </span>
            </span>
          </CardButton>
        ))}
      </div>
    );
  },
};
