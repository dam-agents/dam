import { Launch } from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { externalLinkProps } from "@/lib/external-link";

const CB_KEY_GUIDE_URL = "https://litellm.cb.ete.res.ibm.com/ui/";
const CB_DOCS_URL = "https://ibm.biz/cb-docs";

const curveBenderKeySchema = z
  .object({ value: z.string() })
  .superRefine((data, ctx) => {
    const trimmed = data.value.replace(/\s+/g, "");
    if (trimmed.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Required",
      });
    }
  });

type FormValues = z.infer<typeof curveBenderKeySchema>;

export function CurveBenderForm({
  onSave,
  onCancel,
}: {
  onSave: (input: { value: string }) => Promise<void>;
  onCancel?: () => void;
}) {
  const { register, handleSubmit, formState, watch } = useForm<FormValues>({
    resolver: zodResolver(curveBenderKeySchema),
    mode: "onChange",
    defaultValues: { value: "" },
  });
  const { isSubmitting, isValid } = formState;
  const keyValue = watch("value");
  const showSkWarning =
    keyValue.length > 0 && !keyValue.trimStart().startsWith("sk-");

  const onSubmit = handleSubmit(async (values) => {
    await onSave({ value: values.value.replace(/\s+/g, "") });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6 p-6">
      <div className="flex items-start gap-3">
        <div className="flex size-[68px] shrink-0 items-center justify-center rounded-lg bg-muted">
          <img
            src="/curvebender-logo.svg"
            alt="CurveBender"
            className="size-8"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold text-foreground">
            CurveBender (own key)
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Open-source models hosted internally in IBM.{" "}
            <a
              href={CB_DOCS_URL}
              {...externalLinkProps}
              className="text-primary hover:underline"
            >
              Docs
            </a>
          </div>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="-mt-2 -mr-2 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <span className="sr-only">Cancel</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M12.3 4.7a1 1 0 0 0-1.4-1.4L8 6.6 5.1 3.3a1 1 0 0 0-1.4 1.4L6.6 8 3.3 10.9a1 1 0 1 0 1.4 1.4L8 9.4l2.9 2.9a1 1 0 0 0 1.4-1.4L9.4 8l2.9-2.9z" />
            </svg>
          </button>
        )}
      </div>

      <a
        href={CB_KEY_GUIDE_URL}
        {...externalLinkProps}
        className="group flex items-start justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40"
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-bold text-foreground">
            Need a CurveBender key?
          </span>
          <span className="text-sm text-muted-foreground">
            Generate one in the CurveBender dashboard
          </span>
        </div>
        <Launch
          size={16}
          className="mt-0.5 shrink-0 text-muted-foreground group-hover:text-primary"
        />
      </a>

      <div className="flex flex-col gap-2">
        <div className="flex gap-3">
          <Input
            type="password"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            placeholder="sk-…"
            {...register("value")}
          />
          <Button
            type="submit"
            disabled={isSubmitting || !isValid}
            className="shrink-0"
          >
            {isSubmitting ? "..." : "Save"}
          </Button>
        </div>
        {showSkWarning && (
          <p className="text-sm text-amber-500">
            CurveBender keys usually start with <code>sk-</code>
          </p>
        )}
      </div>
    </form>
  );
}
