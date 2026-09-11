import { zodResolver } from "@hookform/resolvers/zod";
import { type NormalizedGitUrl, normalizeGitUrl } from "agent-runtime-api";
import { INVALID_GIT_URL_MESSAGE, type SkillSource } from "api-server-api";
import { type BaseSyntheticEvent, useMemo } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { z } from "zod";

function duplicateOf(
  sources: readonly SkillSource[],
  gitUrl: string,
): SkillSource | undefined {
  return sources.find((s) => normalizeGitUrl(s.gitUrl)?.gitUrl === gitUrl);
}

function buildSchema(sources: readonly SkillSource[]) {
  return z
    .object({
      name: z.string(),
      gitUrl: z.string(),
      path: z.string(),
    })
    .superRefine((data, ctx) => {
      if (data.name.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["name"],
          message: "Required",
        });
      }
      if (data.gitUrl.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["gitUrl"],
          message: "Required",
        });
        return;
      }
      const normalized = normalizeGitUrl(data.gitUrl);
      if (!normalized) {
        ctx.addIssue({
          code: "custom",
          path: ["gitUrl"],
          message: INVALID_GIT_URL_MESSAGE,
        });
        return;
      }
      const existing = duplicateOf(sources, normalized.gitUrl);
      if (existing) {
        ctx.addIssue({
          code: "custom",
          path: ["gitUrl"],
          message: `Already added as "${existing.name}"`,
        });
      }
    });
}

export type GithubSourceFormValues = {
  name: string;
  gitUrl: string;
  path: string;
};

export interface GithubSourceForm {
  form: UseFormReturn<GithubSourceFormValues>;
  resolved: NormalizedGitUrl | null;
  onSubmit: (e?: BaseSyntheticEvent) => Promise<void>;
}

export function useGithubSourceForm({
  sources,
  onCreate,
  onClose,
}: {
  sources: readonly SkillSource[];
  onCreate: (input: {
    name: string;
    gitUrl: string;
    path?: string;
  }) => Promise<SkillSource | null>;
  onClose: () => void;
}): GithubSourceForm {
  const schema = useMemo(() => buildSchema(sources), [sources]);
  const form = useForm<GithubSourceFormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    shouldUnregister: false,
    defaultValues: { name: "", gitUrl: "", path: "" },
  });

  const resolved = normalizeGitUrl(form.watch("gitUrl"));

  const onSubmit = form.handleSubmit(async (values) => {
    const normalized = normalizeGitUrl(values.gitUrl);
    if (!normalized) return;
    const created = await onCreate({
      name: values.name.trim(),
      gitUrl: normalized.gitUrl,
      path: values.path.trim() || normalized.path,
    });
    if (created) onClose();
  });

  return { form, resolved, onSubmit };
}
