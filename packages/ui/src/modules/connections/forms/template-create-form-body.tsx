import { Launch } from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ConnectionTemplateView } from "api-server-api";
import { type ReactNode, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { emitToast } from "@/lib/toast";

import { useTemplateCreateSubmit } from "../hooks/use-template-create-submit.js";
import { buildCreatePayload } from "../lib/build-create-payload.js";
import { templateSubmitLabel } from "../lib/catalog-providers.js";
import {
  buildTemplateFormSchema,
  templateFormDefaults,
  type TemplateFormValues,
} from "../lib/template-form-schema.js";
import { DisclosureBox } from "./disclosure-box.js";
import { GithubAppScopePicker } from "./github-app-scope-picker.js";
import { GithubAppSetupHint } from "./github-app-setup-hint.js";
import { GithubStepsCallout } from "./github-steps-callout.js";
import { LabeledInput } from "./labeled-input.js";
import { OAuthAppHint } from "./oauth-app-hint.js";
import { OverridableSection } from "./overridable-section.js";
import { TemplateFieldInput } from "./template-field-input.js";

export interface TemplateCreateFormProps {
  template: ConnectionTemplateView;
  onCreated: (id: string) => void;
  onCancel: () => void;
  oauthReturnView?: string;
  popupOAuth?: boolean;
  initialName?: string;
  onNameChange?: (name: string) => void;
  autoFocusName?: boolean;
}

export function TemplateCreateFormBody({
  template,
  onCreated,
  onCancel,
  oauthReturnView,
  popupOAuth,
  initialName,
  onNameChange,
  autoFocusName = true,
  layout = (fields, footer) => (
    <>
      {fields}
      <div className="flex items-center justify-end gap-3 pt-4">{footer}</div>
    </>
  ),
}: TemplateCreateFormProps & {
  layout?: (fields: ReactNode, footer: ReactNode) => ReactNode;
}) {
  const schema = useMemo(() => buildTemplateFormSchema(template), [template]);
  const { control, handleSubmit, setValue } = useForm<TemplateFormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: {
      ...templateFormDefaults(template),
      ...(initialName !== undefined ? { name: initialName } : {}),
    },
  });

  const {
    submit,
    pending,
    authorizing,
    verifying,
    needsOAuth,
    awaitingPopup,
    refocusPopup,
  } = useTemplateCreateSubmit({
    template,
    popupOAuth,
    oauthReturnView,
    onCreated,
  });

  const bringYourOwnApp =
    needsOAuth &&
    template.inputs.find((i) => i.name === "clientId")?.state === "required";

  const extraStr = (k: string): string | undefined => {
    const v = template.extras?.[k];
    return typeof v === "string" ? v : undefined;
  };

  const credentialsFromFamily = template.extras?.credentialsFromFamily === true;

  const onSubmit = handleSubmit((values) => {
    const payload = buildCreatePayload(template, values);
    if ("error" in payload) {
      emitToast({ kind: "error", message: payload.error });
      return;
    }
    void submit(payload);
  });

  const submitCopy = templateSubmitLabel(template.id);
  const isGithubApp = template.authKind === "github-app";
  const scopeInputNames = new Set(
    isGithubApp ? ["repositories", "repositoryIds", "permissions"] : [],
  );

  const required = template.inputs.filter((i) => i.state === "required");
  const optional = template.inputs.filter(
    (i) => i.state === "optional" && !scopeInputNames.has(i.name),
  );
  const overridable = template.inputs.filter((i) => i.state === "overridable");

  const scopeFallbackInputs = template.inputs.filter(
    (i) => i.name === "repositories" || i.name === "permissions",
  );
  const optionalCollapsed = template.category === "mcp";

  const fieldsRegion = (
    <div className="flex flex-col gap-4">
      <GithubStepsCallout templateId={template.id} />

      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <LabeledInput
            label="Name"
            testId="connection-field-name"
            placeholder="my-connection"
            autoFocus={autoFocusName}
            value={field.value}
            onChange={(v) => {
              field.onChange(v);
              onNameChange?.(v);
            }}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
          />
        )}
      />

      {bringYourOwnApp && (
        <OAuthAppHint
          callbackUrl={extraStr("callbackUrl")}
          setupUrl={extraStr("setupUrl")}
        />
      )}

      {isGithubApp && <GithubAppSetupHint templateId={template.id} />}

      {required.map((input) => (
        <TemplateFieldInput
          key={input.name}
          control={control}
          templateId={template.id}
          input={input}
        />
      ))}

      {!optionalCollapsed &&
        optional.map((input) => (
          <TemplateFieldInput
            key={input.name}
            control={control}
            templateId={template.id}
            input={input}
          />
        ))}

      {optionalCollapsed && optional.length > 0 && (
        <DisclosureBox title="Advanced configuration">
          <div className="flex flex-col gap-4">
            {optional.map((input) => (
              <TemplateFieldInput
                key={input.name}
                control={control}
                templateId={template.id}
                input={input}
              />
            ))}
          </div>
        </DisclosureBox>
      )}

      {isGithubApp && (
        <GithubAppScopePicker
          control={control}
          templateId={template.id}
          setField={(name, value) =>
            setValue(`fields.${name}`, value, { shouldDirty: true })
          }
          fallbackInputs={scopeFallbackInputs}
          hostRequired={
            template.inputs.find((i) => i.name === "host")?.state === "required"
          }
        />
      )}

      {overridable.length > 0 && (
        <OverridableSection
          inputs={overridable}
          control={control}
          templateId={template.id}
          fromFamily={credentialsFromFamily}
          overrideHint={
            needsOAuth &&
            overridable.some((i) => i.name === "clientId") && (
              <OAuthAppHint
                callbackUrl={extraStr("callbackUrl")}
                setupUrl={extraStr("setupUrl")}
              />
            )
          }
        />
      )}

      {template.inputs.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No additional inputs — preconfigured.
        </p>
      )}
    </div>
  );

  const footerRegion = (
    <>
      <Button variant="outline" onClick={onCancel} disabled={pending}>
        Cancel
      </Button>
      <Button
        onClick={awaitingPopup ? refocusPopup : onSubmit}
        disabled={pending && !awaitingPopup}
        tooltip={
          awaitingPopup
            ? "Bring the authorization window back to the front"
            : undefined
        }
        data-testid="connection-create-submit"
      >
        {verifying ? (
          "Verifying…"
        ) : awaitingPopup ? (
          "Waiting for authorization — reopen"
        ) : authorizing ? (
          "Redirecting…"
        ) : pending ? (
          "…"
        ) : submitCopy ? (
          <>
            {submitCopy.label}
            {submitCopy.external && <Launch size={14} aria-hidden />}
          </>
        ) : needsOAuth ? (
          "Create + Authorize"
        ) : (
          "Create"
        )}
      </Button>
    </>
  );

  return <>{layout(fieldsRegion, footerRegion)}</>;
}
