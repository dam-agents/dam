import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { KbShareRootsDialog } from "@/modules/knowledge-bases/components/kb-share-roots-dialog";

import { IDS } from "../../backend/scenario";

const meta = {
  title: "Components/KnowledgeBases/KbShareRootsDialog",
  component: KbShareRootsDialog,
  args: {
    agentId: IDS.kbAgent,
    pending: false,
    onCancel: fn(),
    onShare: fn(),
  },
} satisfies Meta<typeof KbShareRootsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
export const Sharing: Story = { args: { pending: true } };
