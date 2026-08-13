export type ImportDomainError =
  | { kind: "InvalidEntry"; path: string; reason: string }
  | { kind: "TarParseError"; detail: string };
