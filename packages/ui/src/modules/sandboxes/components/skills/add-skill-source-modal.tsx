import { LogoGithub, Upload } from "@carbon/icons-react";
import type { SkillSource } from "api-server-api";
import { useState } from "react";

import { DialogHeader, Modal } from "@/components/modal";
import { type TabDef, Tabs } from "@/components/ui/tabs";

import { useGithubSourceForm } from "../../hooks/use-github-source-form.js";
import { useUploadStaging } from "../../hooks/use-upload-staging.js";
import { GithubSourceTab } from "./github-source-tab.js";
import { UploadSkillsTab } from "./upload-skills-tab.js";

type Tab = "github" | "upload";

const TABS: readonly TabDef<Tab>[] = [
  {
    value: "github",
    label: "GitHub repository",
    icon: <LogoGithub size={15} />,
  },
  { value: "upload", label: "Upload .md files", icon: <Upload size={15} /> },
];

/**
 * Add a Skill Source or upload skills. Two tabs — a GitHub repository (a
 * connected source whose skills are installable) and direct Markdown upload
 * (each file becomes a standalone skill). Both apply immediately; there is no
 * staged "Submit changes" step.
 */
export function AddSkillSourceModal({
  onClose,
  onCreate,
  onCreateSkills,
  initialTab = "github",
  initialFiles,
}: {
  onClose: () => void;
  onCreate: (input: {
    name: string;
    gitUrl: string;
    path?: string;
  }) => Promise<SkillSource | null>;
  onCreateSkills: (
    skills: { name: string; content: string }[],
  ) => Promise<
    { ok: true } | { ok: false; conflictNames: string[]; message: string }
  >;
  initialTab?: Tab;
  initialFiles?: File[];
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  // Both tabs' in-progress state is owned by the shell (not the tab
  // components) so switching tabs — which unmounts the inactive tab — never
  // discards the user's typed repo details or staged files.
  const githubForm = useGithubSourceForm({ onCreate, onClose });
  const uploadStaging = useUploadStaging({
    initialFiles,
    onCreateSkills,
    onClose,
  });

  return (
    <Modal>
      <DialogHeader title="Add skill source" onClose={onClose} />

      <Tabs
        ariaLabel="Skill source"
        tabs={TABS}
        value={tab}
        onValueChange={setTab}
        className="px-5 md:px-7"
      />

      {tab === "github" ? (
        <GithubSourceTab github={githubForm} onClose={onClose} />
      ) : (
        <UploadSkillsTab staging={uploadStaging} onClose={onClose} />
      )}
    </Modal>
  );
}
