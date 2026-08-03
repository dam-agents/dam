import { zodResolver } from "@hookform/resolvers/zod";
import type { LocalSkill, SkillSource } from "api-server-api";
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
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { orgRepo } from "@/lib/git-source";

const publishSchema = z.object({
  sourceId: z.string().min(1),
  title: z.string(),
  body: z.string(),
});

type FormValues = z.infer<typeof publishSchema>;

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
  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(publishSchema),
    mode: "onChange",
    defaultValues: {
      sourceId: sources[0]?.id ?? "",
      title: `Add ${skill.name} skill`,
      body: skill.description ?? "",
    },
  });
  const { isSubmitting, isValid } = formState;

  const onSubmit = handleSubmit(async (values) => {
    const ok = await onPublish({
      sourceId: values.sourceId,
      name: skill.name,
      title: values.title,
      body: values.body,
    });
    if (ok) onClose();
  });

  return (
    <Modal>
      <DialogHeader
        title={`Publishing ${skill.name} as a pull request`}
        onClose={onClose}
      />

      <form onSubmit={onSubmit}>
        <DialogBody className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <SectionLabel>Publish to</SectionLabel>
            <Select size="sm" {...register("sourceId")}>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({orgRepo(s.gitUrl)})
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <SectionLabel>Pull request title</SectionLabel>
            <Input size="sm" {...register("title")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <SectionLabel>Description</SectionLabel>
            <Textarea
              className="min-h-[96px] resize-y text-sm"
              rows={4}
              {...register("body")}
            />
          </div>
        </DialogBody>

        <DialogFooter className="border-t border-border">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!isValid || isSubmitting}>
            {isSubmitting ? "Publishing…" : "Publish"}
          </Button>
        </DialogFooter>
      </form>
    </Modal>
  );
}
