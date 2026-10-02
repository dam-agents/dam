import type { Meta, StoryObj } from "@storybook/react-vite";

import { KitSkillsSection } from "@/modules/starter-kits/components/kit-skills-section";

import { KITS } from "../../backend/fixtures/kits";

function kit(id: string) {
  const found = KITS.find((k) => k.id === id);
  if (!found) throw new Error(`no fixture kit ${id}`);
  return found;
}

const meta = {
  title: "Components/Starter kits/KitSkillsSection",
  component: KitSkillsSection,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[720px]">
        <Story />
      </div>
    ),
  ],
  args: { kit: kit("code-guardian") },
} satisfies Meta<typeof KitSkillsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Skills bundled in the kit's repository. */
export const BundledSkills: Story = {};

/** A kit with an external skill source as well. */
export const WithExternalSkills: Story = {
  args: {
    kit: {
      ...kit("code-guardian"),
      skills: [
        {
          name: "pdf",
          source: "https://github.com/anthropics/skills",
        },
      ],
    },
  },
};

/** No skills: renders nothing. */
export const NoSkills: Story = { args: { kit: kit("nous") } };
