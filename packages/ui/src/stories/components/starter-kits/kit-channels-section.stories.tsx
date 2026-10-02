import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { KitChannelsSection } from "@/modules/starter-kits/components/kit-channels-section";

import { KITS } from "../../backend/fixtures/kits";

function kit(id: string) {
  const found = KITS.find((k) => k.id === id);
  if (!found) throw new Error(`no fixture kit ${id}`);
  return found;
}

function Stateful({
  kitId,
  initial = "",
}: {
  kitId: string;
  initial?: string;
}) {
  const [id, setId] = useState(initial);
  return (
    <KitChannelsSection
      kit={kit(kitId)}
      slackChannelId={id}
      onSlackChannelIdChange={setId}
    />
  );
}

const meta = {
  title: "Components/Starter kits/KitChannelsSection",
  component: KitChannelsSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[720px]">
        <Story />
      </div>
    ),
  ],
  args: {
    kit: kit("code-guardian"),
    slackChannelId: "",
    onSlackChannelIdChange: () => {},
  },
} satisfies Meta<typeof KitChannelsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The kit declares a Slack channel, so that row carries the kit tint. */
export const KitDeclaresSlack: Story = {
  render: () => <Stateful kitId="code-guardian" />,
};

export const SlackChannelEntered: Story = {
  render: () => <Stateful kitId="code-guardian" initial="C07HELPPLAT" />,
};

/** A kit with no channels: both rows show their generic blurbs. */
export const NoKitChannels: Story = {
  render: () => <Stateful kitId="nous" />,
};
