import { zodResolver } from "@hookform/resolvers/zod";
import type { ConnectionTemplateView } from "api-server-api";
import { useMemo } from "react";
import { type Control, Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { externalLinkProps } from "@/lib/external-link";
import { emitToast } from "@/lib/toast";

import { MCP_DOCS_URL } from "../../../constants.js";
import { DisclosureBox } from "../forms/disclosure-box.js";
import { LabeledInput } from "../forms/labeled-input.js";
import { useMcpAuthDetection } from "../hooks/use-mcp-auth-detection.js";
import { useTemplateCreateSubmit } from "../hooks/use-template-create-submit.js";
import { buildCreatePayload } from "../lib/build-create-payload.js";
import { validateConnectionName } from "../lib/connection-name.js";
import { validateMcpUrl } from "../lib/mcp-url.js";
import { CatalogPaneHeader } from "./catalog-pane-header.js";

const MCP_OAUTH_TEMPLATE_ID = "custom-mcp-oauth";
const MCP_NONE_TEMPLATE_ID = "custom-mcp-none";

const filled = (s: string) => s.trim() !== "";

const mcpFormSchema = z
  .object({
    name: z.string(),
    url: z.string(),
    clientId: z.string(),
    clientSecret: z.string(),
    headerName: z.string(),
    headerValue: z.string(),
  })
  .superRefine((v, ctx) => {
    const nameError = validateConnectionName(v.name);
    if (nameError)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["name"],
        message: nameError,
      });
    const urlError = validateMcpUrl(v.url);
    if (urlError)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: urlError,
      });
    if (filled(v.clientSecret) && !filled(v.clientId))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clientId"],
        message: "An OAuth secret needs an OAuth ID.",
      });
    if (filled(v.headerName) !== filled(v.headerValue))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [filled(v.headerName) ? "headerValue" : "headerName"],
        message: "Provide both a header name and value, or neither.",
      });
  });

type McpFormValues = z.infer<typeof mcpFormSchema>;

interface Props {
  templateById: Map<string, ConnectionTemplateView>;
  oauthReturnView?: string;
  onBack: () => void;
  onCreated: (id: string) => void;
}

export function McpCreatePane({
  templateById,
  oauthReturnView,
  onBack,
  onCreated,
}: Props) {
  const { control, handleSubmit, watch, formState } = useForm<McpFormValues>({
    resolver: zodResolver(mcpFormSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      url: "",
      clientId: "",
      clientSecret: "",
      headerName: "",
      headerValue: "",
    },
  });
  const url = watch("url");
  const clientId = watch("clientId");
  const headerValue = watch("headerValue");

  const { detected, detecting } = useMcpAuthDetection(url);

  const overriding = filled(clientId) || filled(headerValue);
  const wantsOAuth = filled(clientId)
    ? true
    : filled(headerValue)
      ? false
      : detected === "oauth";
  const showDetecting = detecting && !overriding;
  const template = templateById.get(
    wantsOAuth ? MCP_OAUTH_TEMPLATE_ID : MCP_NONE_TEMPLATE_ID,
  );

  const {
    submit,
    pending,
    authorizing,
    verifying,
    needsOAuth,
    awaitingPopup,
    refocusPopup,
  } = useTemplateCreateSubmit({
    template: template ?? EMPTY_TEMPLATE,
    popupOAuth: true,
    oauthReturnView,
    onCreated,
  });

  const onSubmit = handleSubmit((values) => {
    if (!template) return;
    const fields: Record<string, string> = { url: values.url };
    if (wantsOAuth) {
      fields.clientId = values.clientId;
      fields.clientSecret = values.clientSecret;
    } else {
      fields.headerName = values.headerName;
      fields.value = values.headerValue;
    }
    const payload = buildCreatePayload(template, {
      name: values.name,
      fields,
      overrideDefaults: true,
    });
    if ("error" in payload) {
      emitToast({ kind: "error", message: payload.error });
      return;
    }
    void submit(payload);
  });

  const submitLabel = useMemo(() => {
    if (showDetecting) return "Checking URL…";
    if (verifying) return "Verifying…";
    if (awaitingPopup) return "Waiting for authorization — reopen";
    if (authorizing) return "Redirecting…";
    if (pending) return "…";
    return needsOAuth ? "Create + Authorize" : "Create";
  }, [
    showDetecting,
    verifying,
    awaitingPopup,
    authorizing,
    pending,
    needsOAuth,
  ]);

  return (
    <>
      <CatalogPaneHeader title="Add an MCP server" onBack={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="flex flex-col gap-4">
          <McpField
            control={control}
            name="name"
            label="Name"
            placeholder="my-mcp-server"
            autoFocus
          />
          <McpField
            control={control}
            name="url"
            label="Remote MCP server URL"
            placeholder="https://mcp.example.com/sse"
          />
          <DisclosureBox
            title="Advanced configuration"
            variant="section"
            description={
              <>
                See{" "}
                <a
                  href={MCP_DOCS_URL}
                  {...externalLinkProps}
                  className="font-medium text-foreground underline underline-offset-2 hover:text-accent"
                >
                  documentation
                </a>{" "}
                for more details
              </>
            }
          >
            <div className="flex flex-col gap-4">
              <McpField
                control={control}
                name="clientId"
                label="OAuth ID"
                placeholder="Client ID (optional)"
              />
              <McpField
                control={control}
                name="clientSecret"
                label="OAuth secret"
                type="password"
                placeholder="OAuth secret (optional)"
              />
              <McpField
                control={control}
                name="headerName"
                label="Header name"
                placeholder="Name (optional)"
              />
              <McpField
                control={control}
                name="headerValue"
                label="Header value"
                type="password"
                placeholder="Value (optional)"
              />
            </div>
          </DisclosureBox>
        </div>
      </div>
      <div className="flex justify-end gap-3 border-t border-border px-5 py-4">
        <Button variant="outline" onClick={onBack} disabled={pending}>
          Cancel
        </Button>
        <Button
          onClick={awaitingPopup ? refocusPopup : onSubmit}
          disabled={
            !awaitingPopup &&
            (pending || !template || showDetecting || !formState.isValid)
          }
          tooltip={
            awaitingPopup
              ? "Bring the authorization window back to the front"
              : undefined
          }
          data-testid="connection-create-submit"
        >
          {submitLabel}
        </Button>
      </div>
    </>
  );
}

function McpField({
  control,
  name,
  label,
  placeholder,
  type,
  help,
  autoFocus,
}: {
  control: Control<McpFormValues>;
  name: keyof McpFormValues;
  label: string;
  placeholder?: string;
  type?: "text" | "password";
  help?: string;
  autoFocus?: boolean;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <LabeledInput
          label={label}
          testId={`connection-field-${name}`}
          placeholder={placeholder}
          type={type}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
          help={help}
          error={fieldState.error?.message}
          autoFocus={autoFocus}
          inset
        />
      )}
    />
  );
}

const EMPTY_TEMPLATE: ConnectionTemplateView = {
  id: MCP_NONE_TEMPLATE_ID,
  name: "MCP server",
  category: "mcp",
  isCustom: true,
  authKind: "none",
  inputs: [],
};
