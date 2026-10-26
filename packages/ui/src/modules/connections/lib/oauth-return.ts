export function signedInConnectionId(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get("oauth") !== "success") return null;
  return params.get("connection");
}
