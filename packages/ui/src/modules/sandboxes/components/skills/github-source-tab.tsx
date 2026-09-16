import { DialogActions, DialogBody } from "@/components/modal";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";

import type { GithubSourceForm } from "../../hooks/use-github-source-form.js";

export function GithubSourceTab({
  github,
  onClose,
}: {
  github: GithubSourceForm;
  onClose: () => void;
}) {
  const { register, formState, watch } = github.form;
  const { errors, isSubmitting, isValid } = formState;
  const { resolved } = github;
  const pathOverridden = watch("path").trim().length > 0;

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
          <p className="text-sm text-muted-foreground">
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
          {errors.gitUrl?.message && (
            <p className="text-sm text-destructive">{errors.gitUrl.message}</p>
          )}
          {!errors.gitUrl && resolved && (
            <p className="text-sm text-muted-foreground">
              Repository <code>{resolved.gitUrl}</code>
              {resolved.path && !pathOverridden ? (
                <>
                  , scanning <code>{resolved.path}</code>
                </>
              ) : null}
              {resolved.ref ? (
                <>
                  . The link points at branch <code>{resolved.ref}</code>;
                  skills are always read from the repository default branch.
                </>
              ) : null}
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
          <p className="text-sm text-muted-foreground">
            Repo subdirectory holding the skills, such as <code>skills/</code>.
            Leave empty to search the usual locations.
          </p>
        </div>
      </DialogBody>

      <DialogActions
        divided
        onCancel={onClose}
        label="Add source"
        pendingLabel="Adding…"
        pending={isSubmitting}
        disabled={!isValid}
      />
    </form>
  );
}
