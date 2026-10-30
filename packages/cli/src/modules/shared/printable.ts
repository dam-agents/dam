const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;
const CONTROL_OR_BREAK = /[\x00-\x1f\x7f-\x9f]/g;

/**
 * UNIT_BOUNDARY_DESCRIPTION: text someone else wrote — a kit, a repository,
 * an upstream changelog — made safe to print to a terminal: C0 and C1
 * control characters and DEL are dropped, so an escape sequence cannot move
 * the cursor or rewrite a line the user is asked to check. Tab and newline
 * stay when `lines` is set, for text that has lines.
 */
export function printable(text: string, opts?: { lines?: boolean }): string {
  return text.replace(opts?.lines ? CONTROL : CONTROL_OR_BREAK, "");
}
