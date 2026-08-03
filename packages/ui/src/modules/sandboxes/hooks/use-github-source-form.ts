import { zodResolver } from "@hookform/resolvers/zod";
import type { SkillSource } from "api-server-api";
import type { BaseSyntheticEvent } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { z } from "zod";

/** Ensure a repo URL has a scheme so it passes the `z.url()` create input —
 *  the field placeholder omits `https://`, so users often will too. */
function withScheme(url: string): string {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Shown inline once the user has typed a malformed URL. The empty/"Required"
 *  case is intentionally not surfaced (it would nag an untouched field) — the
 *  disabled Add button already communicates it. Exported so the tab can match
 *  against it to decide whether to render the message. */
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

/**
 * GitHub-repository form for the add-skill-source modal. Lives here (called
 * from the modal shell) rather than inside the tab component so the typed
 * name/URL/path survive switching to the Upload tab and back — symmetric with
 * `useUploadStaging`, so switching tabs never discards in-progress work in
 * either tab.
 */
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
    // Retain field values when the tab (and thus its inputs) unmount on a tab
    // switch, so switching away and back doesn't clear the form.
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
