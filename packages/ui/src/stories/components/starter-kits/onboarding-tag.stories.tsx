import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { OnboardingTag } from "@/modules/starter-kits/components/onboarding-tag";

import { IDS } from "../../backend/scenario";
import { inScenario } from "../shared/in-scenario";

/** `starterKit` is the `<catalog>/<kit>@<commit>` ref the agent was created from. */
const KIT_REF = `${IDS.kitCatalog}/${IDS.kit}@c0de9a4d`;

const STEPS = [
  { id: "state-repo", label: "Pick the state-backup repository", done: true },
  { id: "review-repo", label: "Pick the repository to review", done: false },
  { id: "schedules", label: "Reconcile the kit's schedules", done: false },
];

const meta = {
  title: "Components/Starter kits/OnboardingTag",
  component: OnboardingTag,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="min-h-[280px]">
        <Story />
      </div>
    ),
    inScenario("populated"),
  ],
  args: {
    agent: {
      starterKit: KIT_REF,
      starterKitOnboarded: null,
      onboardingSteps: STEPS,
    },
  },
} satisfies Meta<typeof OnboardingTag>;

export default meta;
type Story = StoryObj<typeof meta>;

/** "Onboarding 1/3"; hover for the checklist (kit name from the catalog). */
export const WithSteps: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByText(/Onboarding/));
  },
};

export const NoSteps: Story = {
  args: {
    agent: { starterKit: KIT_REF, starterKitOnboarded: null },
  },
};

/** Onboarded, or not from a kit: renders nothing. */
export const Onboarded: Story = {
  args: {
    agent: {
      starterKit: KIT_REF,
      starterKitOnboarded: "2026-09-28T10:00:00Z",
      onboardingSteps: STEPS,
    },
  },
};
