import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { KitRequirementRow } from "@/modules/starter-kits/components/kit-requirement-row";
import {
  accepts,
  connectionRequirements,
} from "@/modules/starter-kits/lib/setup";

import { CONNECTIONS, TEMPLATES } from "../../backend/fixtures/connections";
import { KITS } from "../../backend/fixtures/kits";

const templateById = new Map(TEMPLATES.map((t) => [t.id, t]));
const codeGuardian = KITS.find((k) => k.id === "code-guardian");
const [github, slack] = codeGuardian
  ? connectionRequirements(codeGuardian)
  : [];
if (!github || !slack) throw new Error("code-guardian fixture changed");

const grantedFor = (requirement: typeof github) =>
  CONNECTIONS.filter((c) => accepts(requirement, c, templateById));

const meta = {
  title: "Components/Starter kits/KitRequirementRow",
  component: KitRequirementRow,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <ul className="max-w-[720px] overflow-hidden rounded-lg border border-kit-line bg-kit-surface">
        <Story />
      </ul>
    ),
  ],
  args: {
    requirement: github,
    granted: [],
    templateById,
    templates: TEMPLATES,
    maintenance: () => undefined,
    onRevoke: fn(),
    onConnect: fn(),
  },
} satisfies Meta<typeof KitRequirementRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RequiredNotConnected: Story = {};
export const RequiredConnected: Story = {
  args: { granted: grantedFor(github) },
};
export const OptionalNotConnected: Story = { args: { requirement: slack } };
export const OptionalConnected: Story = {
  args: { requirement: slack, granted: grantedFor(slack) },
};
