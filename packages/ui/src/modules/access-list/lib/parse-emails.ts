import { viewerEmailSchema } from "api-server-api";

export interface ParsedEmails {
  emails: string[];
  invalid: string[];
}

// UNIT_BOUNDARY_DESCRIPTION: reads the addresses an operator types or pastes into the add dialog, split on commas, semicolons, spaces and new lines. Each address is lowercased and kept once; a piece that is not an email is returned apart, so the dialog names it instead of dropping it.
export function parseEmails(raw: string): ParsedEmails {
  const emails = new Set<string>();
  const invalid: string[] = [];
  for (const piece of raw.split(/[\s,;]+/)) {
    if (piece === "") continue;
    const parsed = viewerEmailSchema.safeParse(piece);
    if (parsed.success) emails.add(parsed.data);
    else invalid.push(piece);
  }
  return { emails: [...emails], invalid };
}
