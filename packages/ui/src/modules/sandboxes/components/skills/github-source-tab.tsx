import { DialogBody, DialogFooter } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import {
  type GithubSourceForm,
  INVALID_URL_MESSAGE,
} from "../../hooks/use-github-source-form.js";

/**
 * "GitHub repository" tab of the add-skill-source modal: point at a repo whose
 * skills are installed under one group. Sources apply immediately on create —
 * there is no staged "Submit changes" step.
 *
 * Presentational: the form instance lives in `useGithubSourceForm` (owned by
 * the modal shell) so the typed values survive tab switches.
 */
export function GithubSourceTab({
  github,
  onClose,
}: {
  github: GithubSourceForm;
  onClose: () => void;
}) {
  const { register, formState } = github.form;
  const { errors, isSubmitting, isValid } = formState;

  return (
    <form onSubmit={github.onSubmit}>
      <DialogBody className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Skill group name</SectionLabel>
          <Input
            size="sm"
            autoFocus
            placeholder="My skills"
            {...register("name")}
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
            {...register("gitUrl")}
          />
          {errors.gitUrl?.message === INVALID_URL_MESSAGE && (
            <p className="text-[13px] text-destructive">
              {errors.gitUrl.message}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Path (optional)</SectionLabel>
          <Input
            size="sm"
            variant="monospace"
            placeholder="skills/"
            {...register("path")}
          />
        </div>
      </DialogBody>

      <DialogFooter className="border-t border-border">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="submit"
          className={cn(!isValid && "opacity-50")}
          disabled={!isValid || isSubmitting}
        >
          {isSubmitting ? "Adding…" : "Add source"}
        </Button>
      </DialogFooter>
    </form>
  );
}
