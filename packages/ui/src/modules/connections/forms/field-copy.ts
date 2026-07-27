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
  apiBaseUrl: "API base URL",
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
  apiBaseUrl: "https://api.ghe.acme.com",
  envName: "MY_API_KEY",
  caData: "certificate-authority-data from your kubeconfig (base64 or PEM)",
};

// Per-template helper text, keyed by template id then input name.
const TEMPLATE_FIELD_HINTS: Record<string, Record<string, string>> = {
  "github-pat": {
    value:
      "Create a fine-grained token at github.com/settings/tokens — scope it to the exact repos and permissions you want.",
  },
};

export function labelFor(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

export function placeholderFor(key: string): string | undefined {
  return FIELD_PLACEHOLDERS[key];
}

export function hintFor(templateId: string, key: string): string | undefined {
  return TEMPLATE_FIELD_HINTS[templateId]?.[key];
}
