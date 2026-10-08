import { Launch } from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { IBM_LITELLM_HOST, PROVIDERS } from "api-server-api";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KEY_GUIDE_URL } from "@/constants.js";
import { externalLinkProps } from "@/lib/external-link";

import {
  CURVE_BENDER_DESCRIPTION,
  IBM_LITELLM_DESCRIPTION,
} from "../../lib/provider-rows.js";
import { ProviderFormShell, stripWhitespace } from "../provider-form-shell.js";

const liteLlmProxyCredentialSchema = z
  .object({ value: z.string() })
  .superRefine((data, ctx) => {
    if (stripWhitespace(data.value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Required",
      });
    }
  });

type FormValues = z.infer<typeof liteLlmProxyCredentialSchema>;

const LITELLM_PROVIDERS = {
  "ibm-litellm": {
    description: IBM_LITELLM_DESCRIPTION,
    keyGuideUrl: KEY_GUIDE_URL,
  },
  "curve-bender": { description: CURVE_BENDER_DESCRIPTION, keyGuideUrl: null },
} as const;

export function LiteLlmProxyForm({
  provider,
  variant,
  onSave,
  onCancel,
}: {
  provider: keyof typeof LITELLM_PROVIDERS;
  variant: "wizard" | "edit";
  onSave: (input: { value: string }) => Promise<void>;
  onCancel?: () => void;
}) {
  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(liteLlmProxyCredentialSchema),
    mode: "onChange",
    defaultValues: { value: "" },
  });
  const { isSubmitting, isValid } = formState;

  const { description, keyGuideUrl } = LITELLM_PROVIDERS[provider];
  const isEdit = variant === "edit";
  const submitDisabled = isSubmitting || !isValid;

  const onSubmit = handleSubmit(async (values) => {
    await onSave({ value: stripWhitespace(values.value) });
  });

  return (
    <ProviderFormShell
      provider={provider}
      title={PROVIDERS[provider].displayName}
      description={
        isEdit ? "Paste a new token to replace the existing one." : description
      }
      onSubmit={onSubmit}
      onCancel={onCancel}
    >
      {keyGuideUrl && (
        <a
          href={keyGuideUrl}
          {...externalLinkProps}
          className="group flex items-start justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40"
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-bold text-foreground">
              Need an API key?
            </span>
            <span className="text-sm text-muted-foreground">
              Follow the guide and generate your LiteLLM token
            </span>
          </div>
          <Launch
            size={16}
            className="mt-0.5 shrink-0 text-muted-foreground group-hover:text-primary"
          />
        </a>
      )}

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
        <Button type="submit" disabled={submitDisabled} className="shrink-0">
          {isSubmitting ? "..." : isEdit ? "Replace" : "Save"}
        </Button>
      </div>

      {provider === "ibm-litellm" && (
        <p className="text-sm text-muted-foreground">
          There are two ETE LiteLLM instances. Only keys created at{" "}
          <a
            href={`https://${IBM_LITELLM_HOST}/ui?page=api-keys`}
            {...externalLinkProps}
            className="underline hover:text-primary"
          >
            {IBM_LITELLM_HOST}
          </a>{" "}
          work here; keys from ete-litellm.ai-models.vpc-int.res.ibm.com do not.
        </p>
      )}
    </ProviderFormShell>
  );
}
