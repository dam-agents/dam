import type { ConnectionAuthKind } from "api-server-api";
import type { ReactNode } from "react";

import { externalLinkProps } from "@/lib/external-link";

const FIELD_LABELS: Record<string, string> = {
  url: "URL",
  host: "Host",
  issuerUrl: "Issuer URL",
  headerName: "Header name",
  valueFormat: "Value format",
  value: "Secret value",
  clientId: "Client ID",
  clientSecret: "Client secret",
  scopes: "Scopes (space-separated)",
  audience: "Audience",
  appSlug: "GitHub App slug",
  appId: "App ID",
  installationId: "Installation ID",
  privateKey: "Private key (PEM)",
  repositories: "Limit to repositories",
  permissions: "Limit to permissions",
  envName: "Environment variable",
  caData: "Server CA certificate",
};

const FIELD_PLACEHOLDERS: Record<string, string> = {
  url: "https://example.com",
  host: "api.example.com",
  issuerUrl: "https://auth.example.com/realms/main",
  headerName: "X-API-Key",
  valueFormat: "{value}",
  value: "•••••",
  clientId: "Iv1.…",
  clientSecret: "•••••",
  scopes: "read write",
  audience: "https://api.example.com",
  appSlug: "my-platform-app",
  appId: "123456",
  installationId: "987654",
  privateKey: "-----BEGIN RSA PRIVATE KEY-----\n…",
  repositories: "docs handbook",
  permissions: "contents:read metadata:read",
  envName: "MY_API_KEY",
  caData: "certificate-authority-data from your kubeconfig (base64 or PEM)",
};

const GHE_HOST_HINT = "The hostname of your GitHub Enterprise instance";

const TEMPLATE_FIELD_PLACEHOLDERS: Record<string, Record<string, string>> = {
  "github-enterprise": { host: "github.ibm.com" },
  "github-enterprise-pat": { host: "github.ibm.com" },
  "github-enterprise-app": { host: "github.ibm.com" },
};

const TEMPLATE_FIELD_HINTS: Record<string, Record<string, ReactNode>> = {
  "github-pat": {
    value: (
      <>
        Create a token at{" "}
        <a
          href="https://github.com/settings/tokens"
          {...externalLinkProps}
          className="text-primary hover:underline"
        >
          github.com/settings/tokens
        </a>
      </>
    ),
  },
  "github-enterprise": {
    host: GHE_HOST_HINT,
  },
  "github-enterprise-pat": {
    host: GHE_HOST_HINT,
    value: "Create a token at settings/tokens on your GitHub Enterprise host",
  },
  "github-enterprise-app": {
    host: GHE_HOST_HINT,
  },
  slack: {
    clientId:
      "Enable the Slack MCP user-token scopes on your app before authorizing — a scope you miss surfaces later, as a failing Slack call rather than a connect error.",
  },
};

export const CREDENTIAL_COPY: Record<
  Exclude<ConnectionAuthKind, "none">,
  { action: string; label: string; hint: string; multiline?: boolean }
> = {
  oauth: {
    action: "Update client secret",
    label: "New OAuth client secret",
    hint: "The secret of the OAuth app this connection authenticates through. If the stored refresh token still works the connection revives immediately; otherwise re-authenticate afterwards. Other connections using the same OAuth app keep their own copy — update each of them too.",
  },
  header: {
    action: "Update credential",
    label: "New credential value",
    hint: "Replaces the value injected on this connection's hosts.",
  },
  "client-credentials": {
    action: "Update client secret",
    label: "New client secret",
    hint: "Verified by minting a token before it is stored — a wrong secret is rejected.",
  },
  "github-app": {
    action: "Update private key",
    label: "New private key",
    hint: "PEM from your GitHub App. Verified by minting an installation token before it is stored.",
    multiline: true,
  },
};

export function credentialCopyFor(
  authKind: ConnectionAuthKind,
): (typeof CREDENTIAL_COPY)[keyof typeof CREDENTIAL_COPY] | undefined {
  return authKind === "none" ? undefined : CREDENTIAL_COPY[authKind];
}

export function labelFor(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

export function placeholderFor(
  templateId: string,
  key: string,
): string | undefined {
  return (
    TEMPLATE_FIELD_PLACEHOLDERS[templateId]?.[key] ?? FIELD_PLACEHOLDERS[key]
  );
}

export function hintFor(
  templateId: string,
  key: string,
): ReactNode | undefined {
  return TEMPLATE_FIELD_HINTS[templateId]?.[key];
}
