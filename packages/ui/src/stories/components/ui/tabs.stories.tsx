import { LogoGithub, Upload } from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useArgs } from "storybook/preview-api";
import { fn } from "storybook/test";

import { type TabDef, Tabs } from "@/components/ui/tabs";
import { CATALOG_TAB_LABEL } from "@/modules/connections/lib/catalog-providers";
import {
  MODE_KEYS,
  MODES,
} from "@/modules/providers/components/anthropic/modes";

const SETTINGS: readonly TabDef<string>[] = [
  { value: "account", label: "Account" },
  { value: "appearance", label: "Appearance" },
  { value: "providers", label: "Providers" },
  { value: "connections", label: "Connections" },
  { value: "api-keys", label: "API keys" },
  { value: "usage", label: "Usage" },
];

const SKILL_SOURCE: readonly TabDef<string>[] = [
  {
    value: "github",
    label: "GitHub repository",
    icon: <LogoGithub size={16} />,
  },
  { value: "upload", label: "Upload .md files", icon: <Upload size={16} /> },
];

const CREDENTIAL_MODE: readonly TabDef<string>[] = MODE_KEYS.map((mode) => ({
  value: mode,
  label: MODES[mode].label,
}));

const CATALOG_COUNTS = { apps: 42, mcp: 7, "custom-headers": 1 } as const;
const CATALOG: readonly TabDef<string>[] = (
  Object.keys(CATALOG_COUNTS) as (keyof typeof CATALOG_COUNTS)[]
).map((tab) => ({
  value: tab,
  label: CATALOG_TAB_LABEL[tab],
  trailing: (
    <span className="text-muted-foreground">{CATALOG_COUNTS[tab]}</span>
  ),
}));

const meta = {
  title: "Components/UI/Tabs",
  component: Tabs<string>,
  parameters: { layout: "padded" },
  args: {
    tabs: SKILL_SOURCE,
    value: "github",
    onValueChange: fn(),
    variant: "underline",
    orientation: "horizontal",
    size: "default",
    ariaLabel: "Skill source",
  },
  argTypes: {
    variant: { control: "inline-radio", options: ["underline", "pill"] },
    orientation: {
      control: "inline-radio",
      options: ["horizontal", "vertical"],
    },
    size: { control: "inline-radio", options: ["default", "sm"] },
    tabs: { control: false },
    value: { control: "text" },
  },
  render: function Controlled(args) {
    const [, updateArgs] = useArgs<typeof args>();
    return (
      <Tabs
        {...args}
        onValueChange={(value) => {
          updateArgs({ value });
          args.onValueChange(value);
        }}
      />
    );
  },
} satisfies Meta<typeof Tabs<string>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UnderlineWithIcons: Story = {};

export const UnderlineSmall: Story = {
  args: {
    tabs: CREDENTIAL_MODE,
    value: MODE_KEYS[0],
    size: "sm",
    ariaLabel: "Credential mode",
  },
};

export const PillVerticalSmall: Story = {
  args: {
    tabs: SETTINGS,
    value: "providers",
    variant: "pill",
    size: "sm",
    orientation: "vertical",
    ariaLabel: "Settings sections",
    className: "w-[180px]",
  },
};

export const PillVerticalWithTrailing: Story = {
  args: {
    tabs: CATALOG,
    value: "apps",
    variant: "pill",
    orientation: "vertical",
    ariaLabel: "Connection categories",
    className: "w-[200px] border-r border-border p-3",
  },
};

export const PillHorizontal: Story = {
  args: {
    tabs: SETTINGS,
    value: "account",
    variant: "pill",
    size: "sm",
    ariaLabel: "Settings sections",
  },
};

export const WithDisabledTab: Story = {
  args: {
    tabs: [SKILL_SOURCE[0]!, { ...SKILL_SOURCE[1]!, disabled: true }],
  },
};

export const NoneSelected: Story = {
  args: {
    tabs: CATALOG,
    value: null,
    variant: "pill",
    orientation: "vertical",
    className: "w-[200px]",
  },
};
