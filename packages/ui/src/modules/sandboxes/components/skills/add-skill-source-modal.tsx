import { LogoGithub } from "@carbon/icons-react";
import type { SkillSource } from "api-server-api";
import { Upload, X } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { DialogHeader, Modal } from "@/components/modal";
import { cn } from "@/lib/utils";

import { useGithubSourceForm } from "../../hooks/use-github-source-form.js";
import { useUploadStaging } from "../../hooks/use-upload-staging.js";
import { GithubSourceTab } from "./github-source-tab.js";
import { UploadSkillsTab } from "./upload-skills-tab.js";

type Tab = "github" | "upload";

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
      <DialogHeader className="flex items-center justify-between">
        <h2 className="text-[17px] font-semibold text-foreground">
          Add skill source
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </DialogHeader>

      <div role="tablist" className="flex border-b border-border px-5 md:px-7">
        <TabButton active={tab === "github"} onClick={() => setTab("github")}>
          <LogoGithub size={15} /> GitHub repository
        </TabButton>
        <TabButton
          active={tab === "upload"}
          onClick={() => setTab("upload")}
          className="ml-6"
        >
          <Upload size={15} /> Upload .md files
        </TabButton>
      </div>

      {tab === "github" ? (
        <GithubSourceTab github={githubForm} onClose={onClose} />
      ) : (
        <UploadSkillsTab staging={uploadStaging} onClose={onClose} />
      )}
    </Modal>
  );
}

function TabButton({
  active,
  onClick,
  className,
  children,
}: {
  active: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 border-b-2 px-1 py-3 text-[14px] transition-colors",
        active
          ? "border-foreground font-medium text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}
