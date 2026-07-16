import type {
  ConnectionTemplateInput,
  ConnectionTemplateView,
} from "api-server-api";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { emitToast } from "@/lib/toast";

import { useTemplateCreateSubmit } from "../hooks/use-template-create-submit.js";
import { buildCreatePayload } from "../lib/build-create-payload.js";
import { slugifyTemplateName } from "../lib/connection-name.js";
import { DisclosureBox } from "./disclosure-box.js";
import { hintFor, labelFor, placeholderFor } from "./field-copy.js";
import { LabeledInput } from "./labeled-input.js";
import { OAuthAppHint } from "./oauth-app-hint.js";
import { OverridableSection } from "./overridable-section.js";
import { TemplateExplainer } from "./template-explainer.js";

export interface TemplateCreateFormProps {
  template: ConnectionTemplateView;
  onCreated: (id: string) => void;
  onCancel: () => void;
  /** Full-page OAuth return path; defaults to Settings → Connections. */
  oauthReturnView?: string;
  /** Prefer a popup for OAuth (full-page redirect when blocked). */
  popupOAuth?: boolean;
}

/** The create form without dialog chrome, embeddable in any pane. `layout`
 *  arranges the two regions; the dialog wrapper maps them onto
 *  DialogBody/DialogFooter. */
export function TemplateCreateFormBody({
  template,
  onCreated,
  onCancel,
  oauthReturnView,
  popupOAuth,
  layout = (fields, footer) => (
    <>
      {fields}
      <div className="flex items-center justify-end gap-3 pt-4">{footer}</div>
    </>
  ),
}: TemplateCreateFormProps & {
  layout?: (fields: ReactNode, footer: ReactNode) => ReactNode;
}) {
  const [name, setName] = useState(() => slugifyTemplateName(template.name));
  const [fields, setFields] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const i of template.inputs) {
      if (i.presetValue !== undefined && !i.secret)
        init[i.name] = i.presetValue;
    }
    return init;
  });
  const [overrideDefaults, setOverrideDefaults] = useState(false);

  const { submit, pending, authorizing, verifying, needsOAuth } =
    useTemplateCreateSubmit({
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

  // Overridable client creds can come from an operator preset or be reused
  // from a sibling connection in the same credential family — the copy differs.
  const credentialsFromFamily = template.extras?.credentialsFromFamily === true;

  const setF = (k: string, v: string) =>
    setFields((prev) => ({ ...prev, [k]: v }));

  const onSubmit = () => {
    const payload = buildCreatePayload(template, {
      name,
      fields,
      overrideDefaults,
    });
    if ("error" in payload) {
      emitToast({ kind: "error", message: payload.error });
      return;
    }
    void submit(payload);
  };

  const required = template.inputs.filter((i) => i.state === "required");
  const optional = template.inputs.filter((i) => i.state === "optional");
  const overridable = template.inputs.filter((i) => i.state === "overridable");
  // MCP forms tuck their optional OAuth/header fields away (DAM-31); other
  // templates show them inline.
  const optionalCollapsed = template.category === "mcp";

  const fieldsRegion = (
    <div className="flex flex-col gap-4">
      <LabeledInput
        label="Name"
        testId="connection-field-name"
        placeholder="my-connection"
        value={name}
        onChange={setName}
        help="Lowercase letters, digits, and single hyphens (e.g. my-mcp-server). Doubles as the MCP slug."
      />

      {bringYourOwnApp && (
        <OAuthAppHint
          callbackUrl={extraStr("callbackUrl")}
          setupUrl={extraStr("setupUrl")}
        />
      )}

      {required.map((input) => (
        <TemplateFieldInput
          key={input.name}
          templateId={template.id}
          input={input}
          value={fields[input.name] ?? ""}
          onChange={(v) => setF(input.name, v)}
        />
      ))}

      {!optionalCollapsed &&
        optional.map((input) => (
          <TemplateFieldInput
            key={input.name}
            templateId={template.id}
            input={input}
            value={fields[input.name] ?? ""}
            onChange={(v) => setF(input.name, v)}
          />
        ))}

      {optionalCollapsed && optional.length > 0 && (
        <DisclosureBox title="Advanced configuration">
          <div className="flex flex-col gap-4">
            {optional.map((input) => (
              <TemplateFieldInput
                key={input.name}
                templateId={template.id}
                input={input}
                value={fields[input.name] ?? ""}
                onChange={(v) => setF(input.name, v)}
              />
            ))}
          </div>
        </DisclosureBox>
      )}

      {overridable.length > 0 && (
        <OverridableSection
          inputs={overridable}
          fields={fields}
          overriding={overrideDefaults}
          fromFamily={credentialsFromFamily}
          setF={setF}
          setOverriding={setOverrideDefaults}
        />
      )}

      {template.inputs.length === 0 && (
        <p className="text-[12px] text-muted-foreground">
          No additional inputs — preconfigured.
        </p>
      )}

      <TemplateExplainer templateId={template.id} />
    </div>
  );

  const footerRegion = (
    <>
      <Button variant="outline" onClick={onCancel} disabled={pending}>
        Cancel
      </Button>
      <Button
        onClick={onSubmit}
        disabled={pending}
        data-testid="connection-create-submit"
      >
        {verifying
          ? "Verifying…"
          : authorizing
            ? "Redirecting…"
            : pending
              ? "…"
              : needsOAuth
                ? "Create + Authorize"
                : "Create"}
      </Button>
    </>
  );

  return <>{layout(fieldsRegion, footerRegion)}</>;
}

function TemplateFieldInput({
  templateId,
  input,
  value,
  onChange,
}: {
  templateId: string;
  input: ConnectionTemplateInput;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <LabeledInput
      label={
        (input.label ?? labelFor(input.name)) +
        (input.state === "optional" ? " (optional)" : "")
      }
      testId={`connection-field-${input.name}`}
      placeholder={placeholderFor(input.name)}
      type={input.secret ? "password" : "text"}
      value={value}
      onChange={onChange}
      help={hintFor(templateId, input.name) ?? input.hint}
    />
  );
}
