import type { SkillSource } from "api-server-api";
import { useMemo } from "react";

import { DialogHeader, Modal } from "@/components/modal";

import { useGithubSourceForm } from "../../hooks/use-github-source-form.js";
import { useUploadStaging } from "../../hooks/use-upload-staging.js";
import { GithubSourceTab } from "./github-source-tab.js";
import { HiddenSourcesList } from "./hidden-sources-list.js";
import { UploadSkillsTab } from "./upload-skills-tab.js";

export function AddSkillSourceModal({
  sources,
  hiddenSources,
  onShowSource,
  onClose,
  onCreate,
  onCreateSkills,
  mode,
  initialFiles,
}: {
  sources: readonly SkillSource[];
  hiddenSources: readonly SkillSource[];
  onShowSource: (id: string) => Promise<boolean>;
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
  mode: "github" | "upload";
  initialFiles?: File[];
}) {
  const allSources = useMemo(
    () => [...sources, ...hiddenSources],
    [sources, hiddenSources],
  );
  const githubForm = useGithubSourceForm({
    sources: allSources,
    onCreate,
    onClose,
  });
  const uploadStaging = useUploadStaging({
    initialFiles,
    onCreateSkills,
    onClose,
  });

  return (
    <Modal onClose={onClose}>
      <DialogHeader
        title={mode === "github" ? "Add a GitHub source" : "Upload skills"}
        onClose={onClose}
      />

      {mode === "github" ? (
        <GithubSourceTab
          github={githubForm}
          onClose={onClose}
          footer={
            <HiddenSourcesList sources={hiddenSources} onShow={onShowSource} />
          }
        />
      ) : (
        <UploadSkillsTab staging={uploadStaging} onClose={onClose} />
      )}
    </Modal>
  );
}
