import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { OnboardingChecklistCard } from "@/modules/starter-kits/components/onboarding-checklist-card";

const STEPS = [
  { id: "state-repo", label: "Pick the state-backup repository", done: true },
  { id: "review-repo", label: "Pick the repository to review", done: true },
  { id: "schedules", label: "Reconcile the kit's schedules", done: false },
  { id: "summary", label: "Summarise the setup", done: false },
];

const meta = {
  title: "Components/Starter kits/OnboardingChecklistCard",
  component: OnboardingChecklistCard,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="w-72 rounded-lg border border-border bg-popover p-4">
        <Story />
      </div>
    ),
  ],
  args: { title: "Finish onboarding", steps: STEPS },
} satisfies Meta<typeof OnboardingChecklistCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InProgress: Story = {};
export const Dismissible: Story = { args: { onDismiss: fn() } };
export const AllDone: Story = {
  args: { steps: STEPS.map((s) => ({ ...s, done: true })) },
};
/** The agent reported no steps: a generic explanation instead. */
export const NoSteps: Story = { args: { steps: undefined } };
