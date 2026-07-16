import type { LocalSkill, SkillSource } from "api-server-api";
import { X } from "lucide-react";
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
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** `host/org/repo` → `org/repo` for the source dropdown label. */
function orgRepo(gitUrl: string): string {
  return gitUrl
    .replace(/^https?:\/\//, "")
    .replace(/^[^/]+\//, "")
    .replace(/\.git$/, "");
}

/**
 * Publish a Standalone Local Skill upstream as a pull request. Prefills the PR
 * title and description; the target dropdown lists only publishable (GitHub)
 * sources. On success the caller shows the "In review" pill.
 */
export function PublishSkillModal({
  skill,
  sources,
  onPublish,
  onClose,
}: {
  skill: LocalSkill;
  sources: SkillSource[];
  onPublish: (input: {
    sourceId: string;
    name: string;
    title?: string;
    body?: string;
  }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [title, setTitle] = useState(`Add ${skill.name} skill`);
  const [body, setBody] = useState(skill.description ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!sourceId || busy) return;
    setBusy(true);
    const ok = await onPublish({ sourceId, name: skill.name, title, body });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal>
      <DialogHeader className="flex items-start justify-between gap-3">
        <h2 className="text-[17px] font-semibold text-foreground">
          Publishing {skill.name} as a pull request
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </DialogHeader>

      <DialogBody className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Publish to</SectionLabel>
          <Select
            size="sm"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({orgRepo(s.gitUrl)})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Pull request title</SectionLabel>
          <Input
            size="sm"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Description</SectionLabel>
          <Textarea
            className="min-h-[96px] resize-y text-[13px]"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
      </DialogBody>

      <DialogFooter className="border-t border-border">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!sourceId || busy} onClick={submit}>
          {busy ? "Publishing…" : "Publish"}
        </Button>
      </DialogFooter>
    </Modal>
  );
}
