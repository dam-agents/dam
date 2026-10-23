import type { Meta, StoryObj } from "@storybook/react";

import { Button } from "./button";
import { Callout } from "./callout";

const meta: Meta<typeof Callout> = {
  title: "Components/Callout",
  component: Callout,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof Callout>;

export const Default: Story = {
  args: {
    children: (
      <p className="text-sm text-foreground">
        This is a default callout with important information.
      </p>
    ),
  },
};

export const Info: Story = {
  args: {
    tone: "info",
    children: (
      <p className="text-sm text-foreground">
        Your agent is hibernated and will resume when a new session starts.
      </p>
    ),
  },
};

export const Warning: Story = {
  args: {
    tone: "warning",
    children: (
      <>
        <p className="text-sm font-medium text-foreground">
          API key expiring soon
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your Anthropic API key expires in 3 days. Update it in Settings to
          avoid interruptions.
        </p>
      </>
    ),
  },
};

export const Danger: Story = {
  args: {
    tone: "danger",
    children: (
      <>
        <p className="text-sm font-medium text-foreground">Session failed</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The agent sandbox exited with code 137 (out of memory).
        </p>
        <Button variant="outline" size="sm" className="mt-3">
          Retry session
        </Button>
      </>
    ),
  },
};

export const Gradient: Story = {
  args: {
    tone: "gradient",
    children: (
      <p className="text-sm text-foreground">
        Gradient callout for empty states and onboarding.
      </p>
    ),
  },
};

export const MutedCallout: Story = {
  name: "Muted",
  args: {
    tone: "muted",
    children: (
      <p className="text-sm text-muted-foreground">
        No connections configured yet.
      </p>
    ),
  },
};

export const Dashed: Story = {
  args: {
    tone: "muted",
    variant: "dashed",
    children: (
      <p className="text-sm text-muted-foreground">
        No connections configured. You can add git repos, secrets, and
        integrations after creation.
      </p>
    ),
  },
};

export const AllTones: Story = {
  name: "All tones",
  render: () => (
    <div className="flex w-[400px] flex-col gap-3">
      {(
        ["default", "muted", "gradient", "info", "warning", "danger"] as const
      ).map((tone) => (
        <Callout key={tone} tone={tone}>
          <p className="text-sm text-foreground capitalize">{tone} callout</p>
        </Callout>
      ))}
    </div>
  ),
};
