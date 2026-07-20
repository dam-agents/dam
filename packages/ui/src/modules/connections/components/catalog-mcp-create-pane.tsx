import type { ConnectionTemplateView } from "api-server-api";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { emitToast } from "@/lib/toast";

import { DisclosureBox } from "../forms/disclosure-box.js";
import { LabeledInput } from "../forms/labeled-input.js";
import { useMcpAuthDetection } from "../hooks/use-mcp-auth-detection.js";
import { useTemplateCreateSubmit } from "../hooks/use-template-create-submit.js";
import { buildCreatePayload } from "../lib/build-create-payload.js";
import { slugifyTemplateName } from "../lib/connection-name.js";
import { validateMcpUrl } from "../lib/mcp-url.js";
import { CatalogPaneHeader } from "./catalog-pane-header.js";

const MCP_OAUTH_TEMPLATE_ID = "custom-mcp-oauth";
const MCP_NONE_TEMPLATE_ID = "custom-mcp-none";

interface Props {
  templateById: Map<string, ConnectionTemplateView>;
  oauthReturnView?: string;
  onBack: () => void;
  onCreated: (id: string) => void;
}

/** Single entry point for adding an MCP server (#423): Name + URL, with auth
 *  detected from the URL. The Advanced disclosure lets a power user pin a
 *  pre-registered OAuth client or a header credential, overriding detection. */
export function McpCreatePane({
  templateById,
  oauthReturnView,
  onBack,
  onCreated,
}: Props) {
  const [name, setName] = useState(() => slugifyTemplateName("MCP server"));
  const [url, setUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [headerName, setHeaderName] = useState("");
  const [headerValue, setHeaderValue] = useState("");

  // Detection precedes submit so the button label is right and the OAuth
  // popup can open synchronously on click; the submit hook re-verifies.
  const { detected, detecting } = useMcpAuthDetection(url);

  // Explicit advanced input wins over detection: OAuth creds → OAuth flow,
  // a header credential → no-auth flow with gateway injection.
  const overriding = clientId.trim() !== "" || headerValue.trim() !== "";
  const wantsOAuth = clientId.trim()
    ? true
    : headerValue.trim()
      ? false
      : detected === "oauth";
  // The button's Create vs Create + Authorize is only settled once detection
  // resolves — hold it in a loading state rather than let it flip abruptly.
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

  const onSubmit = () => {
    if (!template) return;
    const urlError = validateMcpUrl(url);
    if (urlError) {
      emitToast({ kind: "error", message: urlError });
      return;
    }
    // Both-or-neither: a half-filled pair would otherwise be silently dropped,
    // creating an auth-less connection from credentials the user typed.
    const bothOrNeither = (a: string, b: string) =>
      (a.trim() === "") === (b.trim() === "");
    if (!bothOrNeither(clientId, clientSecret)) {
      emitToast({
        kind: "error",
        message: "Provide both an OAuth ID and secret, or neither.",
      });
      return;
    }
    if (!bothOrNeither(headerName, headerValue)) {
      emitToast({
        kind: "error",
        message: "Provide both a header name and value, or neither.",
      });
      return;
    }
    const fields: Record<string, string> = { url };
    if (wantsOAuth) {
      fields.clientId = clientId;
      fields.clientSecret = clientSecret;
    } else {
      fields.headerName = headerName;
      fields.value = headerValue;
    }
    const payload = buildCreatePayload(template, {
      name,
      fields,
      overrideDefaults: true,
    });
    if ("error" in payload) {
      emitToast({ kind: "error", message: payload.error });
      return;
    }
    void submit(payload);
  };

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
          <LabeledInput
            label="Name"
            testId="connection-field-name"
            placeholder="my-mcp-server"
            value={name}
            onChange={setName}
            help="Lowercase letters, digits, and single hyphens. Doubles as the MCP slug."
          />
          <LabeledInput
            label="Remote MCP server URL"
            testId="connection-field-url"
            placeholder="https://mcp.example.com/sse"
            value={url}
            onChange={setUrl}
          />
          <DisclosureBox title="Advanced configuration">
            <div className="flex flex-col gap-4">
              <LabeledInput
                label="OAuth ID (optional)"
                testId="connection-field-clientId"
                placeholder="Client ID"
                value={clientId}
                onChange={setClientId}
              />
              <LabeledInput
                label="OAuth secret (optional)"
                testId="connection-field-clientSecret"
                type="password"
                value={clientSecret}
                onChange={setClientSecret}
              />
              <LabeledInput
                label="Header name (optional)"
                testId="connection-field-headerName"
                placeholder="X-API-Key"
                value={headerName}
                onChange={setHeaderName}
              />
              <LabeledInput
                label="Header value (optional)"
                testId="connection-field-value"
                type="password"
                value={headerValue}
                onChange={setHeaderValue}
              />
            </div>
          </DisclosureBox>
        </div>
      </div>
      <div className="flex justify-end gap-3 border-t border-border-light px-5 py-4">
        <Button variant="outline" onClick={onBack} disabled={pending}>
          Cancel
        </Button>
        <Button
          onClick={awaitingPopup ? refocusPopup : onSubmit}
          disabled={(pending && !awaitingPopup) || !template || showDetecting}
          title={
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

// A placeholder while templates load — submit is disabled until the real one
// resolves, so this is never used to build a payload.
const EMPTY_TEMPLATE: ConnectionTemplateView = {
  id: MCP_NONE_TEMPLATE_ID,
  name: "MCP server",
  category: "mcp",
  isCustom: true,
  authKind: "none",
  inputs: [],
};
