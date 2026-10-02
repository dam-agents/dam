import type { Meta, StoryObj } from "@storybook/react-vite";
import type { StarterKitScheduleOverride } from "api-server-api";
import { useState } from "react";
import { fn } from "storybook/test";

import { KitScheduleCard } from "@/modules/starter-kits/components/kit-schedule-card";

import { KITS } from "../../backend/fixtures/kits";

function schedule(kitId: string, index = 0) {
  const found = KITS.find((k) => k.id === kitId)?.schedules[index];
  if (!found) throw new Error(`no fixture schedule ${kitId}[${index}]`);
  return found;
}

function Stateful({
  kitId,
  index,
  initialSkipped = false,
  initialOverride,
}: {
  kitId: string;
  index?: number;
  initialSkipped?: boolean;
  initialOverride?: StarterKitScheduleOverride;
}) {
  const s = schedule(kitId, index);
  const [skipped, setSkipped] = useState(initialSkipped);
  const [override, setOverride] = useState(initialOverride);
  return (
    <KitScheduleCard
      schedule={s}
      override={override}
      skipped={skipped}
      onChange={(patch) => setOverride({ name: s.name, ...patch })}
      onInvalid={fn()}
      onToggleSkipped={() => setSkipped((v) => !v)}
    />
  );
}

const meta = {
  title: "Components/Starter kits/KitScheduleCard",
  component: KitScheduleCard,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <ul className="max-w-[720px]">
        <Story />
      </ul>
    ),
  ],
  args: {
    schedule: schedule("code-guardian"),
    override: undefined,
    skipped: false,
    onChange: fn(),
    onInvalid: fn(),
    onToggleSkipped: fn(),
  },
} satisfies Meta<typeof KitScheduleCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A cron schedule from the kit, as declared. Expand to edit its timing. */
export const Declared: Story = {
  render: () => <Stateful kitId="code-guardian" />,
};

/** A schedule the kit ships disabled. */
export const DeclaredDisabled: Story = {
  render: () => {
    const kit = KITS.find((k) => k.id === "code-guardian");
    const index = kit?.schedules.findIndex((s) => !s.enabled) ?? -1;
    return <Stateful kitId="code-guardian" index={Math.max(index, 0)} />;
  },
};

/** Skipped: greyed out with an "Add back" action. */
export const Skipped: Story = {
  render: () => <Stateful kitId="code-guardian" initialSkipped />,
};

export const OtherKit: Story = {
  render: () => <Stateful kitId="personal-assistant" />,
};
