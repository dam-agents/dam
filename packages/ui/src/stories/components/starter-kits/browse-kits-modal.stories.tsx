import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { BrowseKitsModal } from "@/modules/starter-kits/components/browse-kits-modal";

import { inScenario } from "../shared/in-scenario";

/** Reads `starterKits.list` and `connections.templates` from the fixtures. */
const meta = {
  title: "Components/Starter kits/BrowseKitsModal",
  decorators: [inScenario("populated")],
  component: BrowseKitsModal,
  args: { onPick: fn(), onClose: fn(), onStartFromScratch: fn() },
} satisfies Meta<typeof BrowseKitsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllKits: Story = {};
export const SoftwareFilter: Story = { args: { initialFilter: "software" } };
export const KnowledgeFilter: Story = { args: { initialFilter: "knowledge" } };
