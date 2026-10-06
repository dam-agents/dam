import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { agentsKeys } from "@/modules/agents/api/queries";
import { OnboardingBar } from "@/modules/starter-kits/components/onboarding-bar";
import { queryClient } from "@/query-client";
import type { AgentView } from "@/types";

import { AGENTS } from "../../backend/fixtures/agents";
import { IDS } from "../../backend/scenario";

/** No fixture agent was created from a kit, so the story seeds the agents
 *  cache with the fixture coding agent marked as mid-onboarding. */
const ONBOARDING_AGENT: AgentView[] = AGENTS.map((a) =>
  a.id === IDS.codingAgent
    ? {
        ...a,
        starterKit: `${IDS.kitCatalog}/${IDS.kit}@c0de9a4d`,
        starterKitOnboarded: null,
        onboardingSteps: [
          {
            id: "state-repo",
            label: "Pick the state-backup repository",
            done: true,
          },
          {
            id: "review-repo",
            label: "Pick the repository to review",
            done: false,
          },
        ],
      }
    : a,
);

const Seeded: Decorator = (Story) => {
  useState(() => {
    localStorage.removeItem(
      `platform-onboarding-bar-dismissed:${IDS.codingAgent}`,
    );
    queryClient.setQueryData(agentsKeys.listWithChannels(), {
      list: ONBOARDING_AGENT,
      availableChannels: { slack: true },
    });
  });
  return <Story />;
};

const meta = {
  title: "Components/Starter kits/OnboardingBar",
  component: OnboardingBar,
  parameters: { layout: "padded" },
  args: { agentId: IDS.codingAgent },
} satisfies Meta<typeof OnboardingBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Above the chat composer; hover the progress for the checklist. */
export const Onboarding: Story = { decorators: [Seeded] };

/** An agent not created from a kit: renders nothing. */
export const NotFromAKit: Story = { args: { agentId: IDS.kbAgent } };
