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
  const githubForm = useGithubSourceForm({ onCreate, onClose });
  const uploadStaging = useUploadStaging({
    initialFiles,
    onCreateSkills,
    onClose,
  });

  return (
    <Modal>
      <DialogHeader
        title="Add skill source"
        onClose={onClose}
        divided={false}
      />

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
