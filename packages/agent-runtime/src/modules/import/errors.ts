/**
 * Domain errors for the import module. Each kind carries the structured data
 * an HTTP layer needs to render a useful response; the http.ts layer maps
 * these to status codes — no string parsing.
 */
export type ImportDomainError =
  | { kind: "InvalidEntry"; path: string; reason: string }
  | { kind: "ReservedSegment"; path: string; segment: string }
  | { kind: "PrefixEscape"; prefix: string }
  | { kind: "NonTopLevelPath"; path: string }
  | { kind: "TarParseError"; detail: string };
