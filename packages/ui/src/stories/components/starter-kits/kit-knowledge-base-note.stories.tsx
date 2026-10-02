import type { Meta, StoryObj } from "@storybook/react-vite";

import { KitKnowledgeBaseNote } from "@/modules/starter-kits/components/kit-knowledge-base-note";

import { KITS } from "../../backend/fixtures/kits";

function kit(id: string) {
  const found = KITS.find((k) => k.id === id);
  if (!found) throw new Error(`no fixture kit ${id}`);
  return found;
}

const meta = {
  title: "Components/Starter kits/KitKnowledgeBaseNote",
  component: KitKnowledgeBaseNote,
  parameters: { layout: "padded" },
  args: { kit: kit("llm-wiki"), className: "text-sm" },
} satisfies Meta<typeof KitKnowledgeBaseNote>;

export default meta;
type Story = StoryObj<typeof meta>;

export const KnowledgeBaseKit: Story = {};

/** Kits without a knowledge base render nothing. */
export const NotAKnowledgeBase: Story = { args: { kit: kit("code-guardian") } };
