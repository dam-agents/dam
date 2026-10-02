import { Settings } from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { Badge } from "./badge";
import { Tabs } from "./tabs";

const meta: Meta<typeof Tabs> = {
  title: "Components/Tabs",
  component: Tabs,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj;

const basicTabs = [
  { value: "overview", label: "Overview" },
  { value: "sessions", label: "Sessions" },
  { value: "artifacts", label: "Artifacts" },
  { value: "settings", label: "Settings" },
] as const;

function UnderlineTabs() {
  const [value, setValue] = useState<string>("overview");
  return (
    <Tabs
      tabs={basicTabs}
      value={value}
      onValueChange={setValue}
      ariaLabel="Agent tabs"
    />
  );
}

function PillTabs() {
  const [value, setValue] = useState<string>("all");
  return (
    <Tabs
      tabs={[
        { value: "all", label: "All" },
        { value: "running", label: "Running" },
        { value: "idle", label: "Idle" },
      ]}
      value={value}
      onValueChange={setValue}
      variant="pill"
      ariaLabel="Filter tabs"
    />
  );
}

function SmallPillTabs() {
  const [value, setValue] = useState<string>("all");
  return (
    <Tabs
      tabs={[
        { value: "all", label: "All" },
        { value: "coding", label: "Coding" },
        { value: "research", label: "Research" },
      ]}
      value={value}
      onValueChange={setValue}
      variant="pill"
      size="sm"
      ariaLabel="Category tabs"
    />
  );
}

function TabsWithIcons() {
  const [value, setValue] = useState<string>("overview");
  return (
    <Tabs
      tabs={[
        { value: "overview", label: "Overview" },
        { value: "settings", label: "Settings", icon: <Settings size={16} /> },
        {
          value: "sessions",
          label: "Sessions",
          trailing: (
            <Badge variant="muted" size="sm">
              12
            </Badge>
          ),
        },
      ]}
      value={value}
      onValueChange={setValue}
      ariaLabel="Tabs with icons"
    />
  );
}

function TabsWithDisabled() {
  const [value, setValue] = useState<string>("overview");
  return (
    <Tabs
      tabs={[
        { value: "overview", label: "Overview" },
        { value: "sessions", label: "Sessions" },
        { value: "billing", label: "Billing", disabled: true },
      ]}
      value={value}
      onValueChange={setValue}
      ariaLabel="Tabs with disabled"
    />
  );
}

export const Underline: Story = {
  render: () => <UnderlineTabs />,
};

export const Pill: Story = {
  render: () => <PillTabs />,
};

export const SmallPill: Story = {
  name: "Pill (small)",
  render: () => <SmallPillTabs />,
};

export const WithIcons: Story = {
  name: "With icons and trailing",
  render: () => <TabsWithIcons />,
};

export const WithDisabled: Story = {
  name: "With disabled tab",
  render: () => <TabsWithDisabled />,
};
