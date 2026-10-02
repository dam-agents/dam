import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { EnvVarsEditor } from "@/components/env-vars-editor";
import type { EnvVar } from "@/types";

function Stateful({
  initial,
  disabled,
}: {
  initial: EnvVar[];
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <EnvVarsEditor value={value} onChange={setValue} disabled={disabled} />
  );
}

const meta = {
  title: "Components/Shared/EnvVarsEditor",
  component: EnvVarsEditor,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[560px]">
        <Story />
      </div>
    ),
  ],
  args: { value: [], onChange: () => {} },
} satisfies Meta<typeof EnvVarsEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { render: () => <Stateful initial={[]} /> };

export const WithValues: Story = {
  render: () => (
    <Stateful
      initial={[
        { name: "NODE_ENV", value: "production" },
        { name: "LOG_LEVEL", value: "debug" },
      ]}
    />
  ),
};

/** Names must match [A-Z_][A-Z0-9_]*. */
export const InvalidName: Story = {
  render: () => <Stateful initial={[{ name: "1API_KEY", value: "abc" }]} />,
};

export const Disabled: Story = {
  render: () => (
    <Stateful initial={[{ name: "NODE_ENV", value: "production" }]} disabled />
  ),
};
