import type { ReactNode } from "react";

import { FormField } from "@/components/form-field";
import { DialogActions, DialogBody } from "@/components/modal";
import { Input } from "@/components/ui/input";

import type { GithubSourceForm } from "../../hooks/use-github-source-form.js";

export function GithubSourceTab({
  github,
  onClose,
  footer,
}: {
  github: GithubSourceForm;
  onClose: () => void;
  footer?: ReactNode;
}) {
  const { register, formState, watch } = github.form;
  const { errors, isSubmitting, isValid } = formState;
  const { resolved } = github;
  const pathOverridden = watch("path").trim().length > 0;

  return (
    <form className="contents" onSubmit={github.onSubmit}>
      <DialogBody className="flex flex-col gap-5">
        <FormField
          label="Skill group name"
          hint="All .md skill files in this repo will be added under this group."
        >
          <Input autoFocus placeholder="My skills" {...register("name")} />
        </FormField>
        <FormField
          label="Repository URL"
          error={errors.gitUrl?.message}
          hint={
            !errors.gitUrl &&
            resolved && (
              <span>
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
              </span>
            )
          }
        >
          <Input
            variant="monospace"
            placeholder="github.ibm.com/org/repo-name"
            {...register("gitUrl")}
          />
        </FormField>
        <FormField
          label="Path (optional)"
          hint={
            <>
              Repo subdirectory holding the skills, such as <code>skills/</code>
              . Leave empty to search the usual locations.
            </>
          }
        >
          <Input
            variant="monospace"
            placeholder="skills/"
            {...register("path")}
          />
        </FormField>
        {footer}
      </DialogBody>

      <DialogActions
        onCancel={onClose}
        label="Add source"
        pendingLabel="Adding…"
        pending={isSubmitting}
        disabled={!isValid}
      />
    </form>
  );
}
