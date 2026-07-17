import { LogoGithub } from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { SkillSource } from "api-server-api";
import { Upload, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

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

const addSourceSchema = z
  .object({
    name: z.string(),
    gitUrl: z.string(),
    path: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.name.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["name"],
        message: "Required",
      });
    }
    if (data.gitUrl.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gitUrl"],
        message: "Required",
      });
    } else if (!z.string().url().safeParse(withScheme(data.gitUrl)).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gitUrl"],
        message: "Enter a valid repository URL",
      });
    }
  });

type FormValues = z.infer<typeof addSourceSchema>;

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
  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(addSourceSchema),
    mode: "onChange",
    defaultValues: { name: "", gitUrl: "", path: "" },
  });
  const { errors, isSubmitting, isValid } = formState;

  const onSubmit = handleSubmit(async (values) => {
    const created = await onCreate({
      name: values.name.trim(),
      gitUrl: withScheme(values.gitUrl),
      path: values.path.trim() || undefined,
    });
    if (created) onClose();
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

      <form onSubmit={onSubmit}>
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
            {errors.gitUrl?.message === "Enter a valid repository URL" && (
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
    </Modal>
  );
}
