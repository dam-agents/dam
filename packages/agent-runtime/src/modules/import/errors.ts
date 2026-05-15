/**
 * Domain errors for the import module. The http.ts layer maps these to
 * status codes — no string parsing.
 */
export type ImportDomainError =
  | { kind: "InvalidEntry"; path: string; reason: string }
  | { kind: "TarParseError"; detail: string };
