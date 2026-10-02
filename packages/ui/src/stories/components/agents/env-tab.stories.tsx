import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ComponentProps, useState } from "react";
import { fn } from "storybook/test";

import type { EnvVar } from "@/types";

import { EnvTab } from "../../../modules/agents/components/configure-agent/env-tab.js";
import { useInheritedEnvs } from "../../../modules/sandboxes/hooks/use-inherited-envs.js";
import { CONNECTIONS } from "../../backend/fixtures/connections";
import { codingAgent } from "./story-helpers";

const agent = codingAgent();

/** The inherited list is what the real `useInheritedEnvs` derives from the
 *  fixture connections checkout-service is granted (GitHub, Anthropic) plus
 *  the platform-managed PORT. */
function EnvTabStory(props: ComponentProps<typeof EnvTab>) {
  const [envVars, setEnvVars] = useState<EnvVar[]>(props.envVars);
  const inherited = useInheritedEnvs({
    agentEnv: [{ name: "PORT", value: "8080" }],
    apps: CONNECTIONS,
    appIdsSet: new Set(agent.grantedConnectionIds),
    envVars,
  });
  return (
    <EnvTab
      {...props}
      inherited={props.inherited.length ? props.inherited : inherited}
      envVars={envVars}
      setEnvVars={(v) => {
        setEnvVars(v);
        props.setEnvVars(v);
      }}
    />
  );
}

const meta = {
  title: "Components/Agents/EnvTab",
  component: EnvTab,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[640px]">
        <Story />
      </div>
    ),
  ],
  render: (args) => <EnvTabStory {...args} />,
  args: {
    inherited: [],
    envVars: [
      { name: "NODE_ENV", value: "development" },
      { name: "LOG_LEVEL", value: "debug" },
    ],
    setEnvVars: fn(),
    saving: false,
  },
} satisfies Meta<typeof EnvTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NoCustomVars: Story = { args: { envVars: [] } };

/** A custom GH_TOKEN hides the one the GitHub connection injects. */
export const ShadowingInherited: Story = {
  args: {
    inherited: [
      { name: "PORT", value: "8080", source: "system" },
      { name: "GH_TOKEN", value: "••••••••", source: { appLabel: "GitHub" } },
    ],
    envVars: [{ name: "GH_TOKEN", value: "ghp_local_test_token" }],
  },
};

export const Saving: Story = { args: { saving: true } };
