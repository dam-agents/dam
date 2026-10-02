import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { api } from "@/api";
import { DialogHeader, Modal } from "@/components/modal";
import { UploadSkillsTab } from "@/modules/sandboxes/components/skills/upload-skills-tab";
import { useUploadStaging } from "@/modules/sandboxes/hooks/use-upload-staging";

import { IDS } from "../../../backend/scenario";
import { ensureScenario } from "./skills-harness";

interface Args {
  withFiles: boolean;
  onClose: () => void;
}

/** A dropped .md file built from the coding agent's runbook skill. */
const load = async () => {
  ensureScenario("populated");
  const { files } = await api.skills.readLocal.query({
    agentId: IDS.codingAgent,
    name: "checkout-runbook",
  });
  const manifest = files.find((f) => f.relPath === "SKILL.md");
  return {
    dropped: new File([manifest?.content ?? ""], "checkout-runbook.md", {
      type: "text/markdown",
    }),
  };
};
type Loaded = Awaited<ReturnType<typeof load>>;

function Tab({ files, onClose }: { files?: File[]; onClose: () => void }) {
  const staging = useUploadStaging({
    initialFiles: files,
    onCreateSkills: async () => ({ ok: true }),
    onClose,
  });
  return (
    <Modal>
      <DialogHeader
        title="Add skill source"
        onClose={onClose}
        divided={false}
      />
      <UploadSkillsTab staging={staging} onClose={onClose} />
    </Modal>
  );
}

const meta = {
  title: "Components/Sandboxes/Skills/UploadSkillsTab",
  loaders: [load],
  args: { withFiles: false, onClose: fn() },
  render: ({ withFiles, onClose }, { loaded }) => (
    <Tab
      files={withFiles ? [(loaded as Loaded).dropped] : undefined}
      onClose={onClose}
    />
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const StagedFile: Story = { args: { withFiles: true } };
