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
  envName: "Environment variable",
  caData: "Server CA certificate (optional)",
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
  envName: "MY_API_KEY",
  caData: "certificate-authority-data from your kubeconfig (base64 or PEM)",
};

export function labelFor(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

export function placeholderFor(key: string): string | undefined {
  return FIELD_PLACEHOLDERS[key];
}
