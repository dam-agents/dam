import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";

import { PROVIDERS } from "../../../../types.js";
import {
  ProviderFormShell,
  ProviderKeyLink,
  ProviderSecretRow,
  stripWhitespace,
} from "../provider-form-shell.js";

const OPENAI_DISPLAY_NAME = PROVIDERS.openai.displayName;
const OPENAI_KEY_PAGE_URL = "https://platform.openai.com/api-keys";

const openaiCredentialSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("api-key"),
    value: z.string().refine((value) => stripWhitespace(value).length > 0, {
      message: "Required",
    }),
  }),
  z.object({ mode: z.literal("chatgpt"), value: z.string() }),
]);

type FormValues = z.infer<typeof openaiCredentialSchema>;
type Mode = FormValues["mode"];

export function OpenAIForm({
  variant,
  initialMode = "api-key",
  onSave,
  onCancel,
}: {
  variant: "wizard" | "edit";
  initialMode?: Mode;
  onSave: (input: FormValues) => Promise<void>;
  onCancel?: () => void;
}) {
  const { register, handleSubmit, watch, formState } = useForm<FormValues>({
    resolver: zodResolver(openaiCredentialSchema),
    mode: "onChange",
    defaultValues: { mode: initialMode, value: "" },
  });
  const { errors, isSubmitting, isValid } = formState;

  const isEdit = variant === "edit";
  const submitDisabled = isSubmitting || !isValid;
  const value = watch("value");
  const mode = watch("mode");

  const onSubmit = handleSubmit(async (values) => {
    await onSave({
      ...values,
      value: values.mode === "api-key" ? stripWhitespace(values.value) : "",
    });
  });

  return (
    <ProviderFormShell
      provider={mode === "chatgpt" ? "chatgpt" : "openai"}
      title={
        mode === "chatgpt" ? PROVIDERS.chatgpt.displayName : OPENAI_DISPLAY_NAME
      }
      description={
        mode === "chatgpt"
          ? "Use your ChatGPT subscription with Codex. Sign in separately on each agent."
          : isEdit
            ? "Paste a new API key to replace the existing one."
            : "Powers Codex agents and any harness that reads OPENAI_API_KEY."
      }
      onSubmit={onSubmit}
      onCancel={onCancel}
      closeDisabled={isSubmitting}
    >
      {mode === "chatgpt" ? (
        <>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              After attaching this provider, open the agent’s Providers page and
              select Sign in to ChatGPT. Follow the device sign-in steps there.
              That login also powers the agent's web chat and Slack sessions
              when you select a subscription model.
            </p>
            <p>Approve the device code in your own browser.</p>
            <p>
              Restart the agent after reauthorizing an expired login, signing
              out or switching ChatGPT accounts so existing sessions use the new
              login state.
            </p>
            <p>
              The login is stored on the agent. Anyone allowed to run work on it
              uses that subscription. Its calls are outside the platform's model
              spend limits.
            </p>
          </div>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Saving…"
              : isEdit
                ? "Done"
                : "Enable ChatGPT subscription"}
          </Button>
        </>
      ) : (
        <>
          <ProviderKeyLink
            href={OPENAI_KEY_PAGE_URL}
            hint="Create a secret key in the OpenAI dashboard"
          />
          <ProviderSecretRow
            register={register("value")}
            placeholder="sk-…"
            ariaLabel="OpenAI API key"
            isEdit={isEdit}
            isSubmitting={isSubmitting}
            submitDisabled={submitDisabled}
            value={value}
            error={errors.value}
          />
        </>
      )}
    </ProviderFormShell>
  );
}
