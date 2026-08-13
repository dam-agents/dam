import { zodResolver } from "@hookform/resolvers/zod";
import type { SkillSource } from "api-server-api";
import type { BaseSyntheticEvent } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { z } from "zod";

function withScheme(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export const INVALID_URL_MESSAGE = "Enter a valid repository URL";

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
        message: INVALID_URL_MESSAGE,
      });
    }
  });

export type GithubSourceFormValues = z.infer<typeof addSourceSchema>;

export interface GithubSourceForm {
  form: UseFormReturn<GithubSourceFormValues>;
  onSubmit: (e?: BaseSyntheticEvent) => Promise<void>;
}

export function useGithubSourceForm({
  onCreate,
  onClose,
}: {
  onCreate: (input: {
    name: string;
    gitUrl: string;
    path?: string;
  }) => Promise<SkillSource | null>;
  onClose: () => void;
}): GithubSourceForm {
  const form = useForm<GithubSourceFormValues>({
    resolver: zodResolver(addSourceSchema),
    mode: "onChange",
    shouldUnregister: false,
    defaultValues: { name: "", gitUrl: "", path: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    const created = await onCreate({
      name: values.name.trim(),
      gitUrl: withScheme(values.gitUrl),
      path: values.path.trim() || undefined,
    });
    if (created) onClose();
  });

  return { form, onSubmit };
}
