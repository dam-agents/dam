import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { KitRequirementsCard } from "@/modules/starter-kits/components/kit-requirements-card";
import { accepts } from "@/modules/starter-kits/lib/setup";

import { CONNECTIONS, TEMPLATES } from "../../backend/fixtures/connections";
import { KITS } from "../../backend/fixtures/kits";

const templateById = new Map(TEMPLATES.map((t) => [t.id, t]));

function kit(id: string) {
  const found = KITS.find((k) => k.id === id);
  if (!found) throw new Error(`no fixture kit ${id}`);
  return found;
}

/** The fixture connections that satisfy one of the kit's requirements. */
function grantedFor(kitId: string) {
  const k = kit(kitId);
  return CONNECTIONS.filter((c) =>
    k.connections.some((r) => accepts(r, c, templateById)),
  );
}

const meta = {
  title: "Components/Starter kits/KitRequirementsCard",
  component: KitRequirementsCard,
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
    granted: [],
    templateById,
    templates: TEMPLATES,
    onRevoke: fn(),
    onConnect: fn(),
  },
} satisfies Meta<typeof KitRequirementsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing connected yet: each requirement offers Connect. */
export const NothingConnected: Story = {};

/** The user's existing GitHub and Slack connections satisfy the kit. */
export const Connected: Story = {
  args: { granted: grantedFor("code-guardian") },
};

export const PersonalAssistant: Story = {
  args: {
    kit: kit("personal-assistant"),
    granted: grantedFor("personal-assistant"),
  },
};
