import { WarningAlt } from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { CURVE_BENDER_HOST, IBM_LITELLM_HOST, PROVIDERS } from "api-server-api";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Notice } from "@/components/ui/notice";
import { KEY_GUIDE_URL } from "@/constants.js";
import { externalLinkProps } from "@/lib/external-link";

import {
  CURVE_BENDER_DESCRIPTION,
  IBM_LITELLM_DESCRIPTION,
} from "../../lib/provider-rows.js";
import {
  ProviderFormShell,
  ProviderSecretRow,
  requiredSecretSchema,
  stripWhitespace,
} from "../provider-form-shell.js";

const liteLlmProxyCredentialSchema = z.object({
  value: requiredSecretSchema,
});

type FormValues = z.infer<typeof liteLlmProxyCredentialSchema>;

const MARK =
  "rounded-sm bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-400/30";

const CURVE_BENDER_KEY_PREFIX = "sk-";

const LITELLM_PROVIDERS = {
  "ibm-litellm": {
    description: IBM_LITELLM_DESCRIPTION,
    keyGuideUrl: KEY_GUIDE_URL,
    keyGuideHint: "Follow the guide and generate your LiteLLM token",
  },
  "curve-bender": {
    description: CURVE_BENDER_DESCRIPTION,
    keyGuideUrl: `https://${CURVE_BENDER_HOST}/ui/`,
    keyGuideHint: "Generate a key in the CurveBender LiteLLM dashboard",
  },
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
  const { register, handleSubmit, watch, formState } = useForm<FormValues>({
    resolver: zodResolver(liteLlmProxyCredentialSchema),
    mode: "onChange",
    defaultValues: { value: "" },
  });
  const { isSubmitting, isValid } = formState;

  const { description, keyGuideUrl, keyGuideHint } =
    LITELLM_PROVIDERS[provider];
  const isEdit = variant === "edit";
  const submitDisabled = isSubmitting || !isValid;
  const value = stripWhitespace(watch("value"));

  const onSubmit = handleSubmit(async (values) => {
    await onSave({ value: stripWhitespace(values.value) });
  });

  return (
    <ProviderFormShell
      provider={provider}
      title={PROVIDERS[provider].displayName}
      description={
        <>
          {isEdit
            ? "Paste a new token to replace the existing one."
            : description}
          {provider === "curve-bender" && (
            <>
              {" "}
              <a
                href="https://ibm.biz/cb-docs"
                {...externalLinkProps}
                className="underline hover:text-primary"
              >
                CurveBender documentation
              </a>
              .
            </>
          )}
        </>
      }
      keyPage={{ href: keyGuideUrl, hint: keyGuideHint }}
      onSubmit={onSubmit}
      onCancel={onCancel}
      closeDisabled={isSubmitting}
    >
      <ProviderSecretRow
        register={register("value")}
        placeholder="sk-…"
        ariaLabel={`${PROVIDERS[provider].displayName} API key`}
        isEdit={isEdit}
        isSubmitting={isSubmitting}
        submitDisabled={submitDisabled}
      />

      {provider === "curve-bender" &&
        value.length > 0 &&
        !value.startsWith(CURVE_BENDER_KEY_PREFIX) && (
          <Notice
            icon={WarningAlt}
            tone="warning"
            title="This isn't a CurveBender key."
          >
            CurveBender keys start with {CURVE_BENDER_KEY_PREFIX}, and IBM Cloud
            API keys don't work here. Generate a key in the{" "}
            <a
              href={keyGuideUrl}
              {...externalLinkProps}
              className="underline hover:text-primary"
            >
              CurveBender LiteLLM dashboard
            </a>
            .
          </Notice>
        )}

      {provider === "ibm-litellm" && (
        <p className="text-sm text-muted-foreground">
          There are two ETE LiteLLM instances. Only keys created at{" "}
          <a
            href={`https://${IBM_LITELLM_HOST}/ui?page=api-keys`}
            {...externalLinkProps}
            className="underline hover:text-primary"
          >
            ete-litellm.ai-models.<mark className={MARK}>vpc</mark>.res.ibm.com
          </a>{" "}
          work here; keys from ete-litellm.ai-models.
          <mark className={MARK}>vpc-int</mark>.res.ibm.com do not.
        </p>
      )}
    </ProviderFormShell>
  );
}
