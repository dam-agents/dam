import type { SkillSource } from "api-server-api";

import { DialogHeader, Modal } from "@/components/modal";

import { useGithubSourceForm } from "../../hooks/use-github-source-form.js";
import { useUploadStaging } from "../../hooks/use-upload-staging.js";
import { GithubSourceTab } from "./github-source-tab.js";
import { UploadSkillsTab } from "./upload-skills-tab.js";

export function AddSkillSourceModal({
  sources,
  onClose,
  onCreate,
  onCreateSkills,
  mode,
  initialFiles,
}: {
  sources: readonly SkillSource[];
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
  const githubForm = useGithubSourceForm({ sources, onCreate, onClose });
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
        <GithubSourceTab github={githubForm} onClose={onClose} />
      ) : (
        <UploadSkillsTab staging={uploadStaging} onClose={onClose} />
      )}
    </Modal>
  );
}
