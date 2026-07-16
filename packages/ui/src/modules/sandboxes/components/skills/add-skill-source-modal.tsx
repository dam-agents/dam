import { LogoGithub } from "@carbon/icons-react";
import type { SkillSource } from "api-server-api";
import { Upload, X } from "lucide-react";
import { useState } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

/** Ensure a repo URL has a scheme so it passes the `z.url()` create input —
 *  the field placeholder omits `https://`, so users often will too. */
function withScheme(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Add a Skill Source. Only the GitHub-repository tab is functional; the
 * "Upload .md files" tab is shown disabled ("coming soon") since there's no
 * upload backend yet (deferred — see docs/plan/944). Sources apply immediately
 * on create — there is no staged "Submit changes" step.
 */
export function AddSkillSourceModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: {
    name: string;
    gitUrl: string;
    path?: string;
  }) => Promise<SkillSource | null>;
}) {
  const [name, setName] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit = name.trim().length > 0 && gitUrl.trim().length > 0;

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    const created = await onCreate({
      name,
      gitUrl: withScheme(gitUrl),
      path: path.trim() || undefined,
    });
    setBusy(false);
    if (created) onClose();
  };

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

      {/* Tab strip: GitHub is the working path; Upload is disabled until the
          upload backend lands, so it never becomes the default. */}
      <div className="flex border-b border-border px-5 md:px-7">
        <span className="flex items-center gap-2 border-b-2 border-foreground px-1 py-3 text-[14px] font-medium text-foreground">
          <LogoGithub size={15} /> GitHub repository
        </span>
        <span
          title="Coming soon"
          aria-disabled="true"
          className="ml-6 flex cursor-not-allowed items-center gap-2 px-1 py-3 text-[14px] text-muted-foreground/50"
        >
          <Upload size={15} /> Upload .md files
        </span>
      </div>

      <DialogBody className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Skill group name</SectionLabel>
          <Input
            size="sm"
            autoFocus
            placeholder="My skills"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-[13px] text-muted-foreground">
            All .md skill files in this repo will be added under this group.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Repository URL</SectionLabel>
          <Input
            size="sm"
            variant="monospace"
            placeholder="github.ibm.com/org/repo-name"
            value={gitUrl}
            onChange={(e) => setGitUrl(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Path (optional)</SectionLabel>
          <Input
            size="sm"
            variant="monospace"
            placeholder="skills/"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </div>
      </DialogBody>

      <DialogFooter className="border-t border-border">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className={cn(!canSubmit && "opacity-50")}
          disabled={!canSubmit || busy}
          onClick={submit}
        >
          {busy ? "Adding…" : "Add source"}
        </Button>
      </DialogFooter>
    </Modal>
  );
}
