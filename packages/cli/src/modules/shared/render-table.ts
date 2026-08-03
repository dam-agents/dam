export function renderTable(rows: string[][]): string {
  const widths = rows[0]!.map((_, col) =>
    Math.max(...rows.map((r) => r[col]!.length)),
  );
  return (
    rows
      .map((row) =>
        row
          .map((cell, col) =>
            col === row.length - 1
              ? cell
              : cell + " ".repeat(widths[col]! - cell.length),
          )
          .join("   "),
      )
      .join("\n") + "\n"
  );
}

/** renderTable's inter-column gap. */
const COLUMN_GAP = 3;
/** Floor for the flex column on narrow terminals. */
const MIN_FLEX_WIDTH = 20;

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Truncate to `max` display columns, appending `…` when clipped. */
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Render a table where one column holds free-form text (a description, a URL,
 * a request line). renderTable doesn't wrap, so a long cell would soft-wrap at
 * the terminal edge and bleed across rows; collapse the flex column to one
 * line and truncate it with `…` to whatever width the other columns leave.
 * `flexCol` defaults to the last column. `--json` paths keep the full text.
 */
export function renderFittedTable(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  flexCol: number = header.length - 1,
): string {
  let fixedWidth = 0;
  for (let col = 0; col < header.length; col++) {
    if (col === flexCol) continue;
    const w = Math.max(header[col]!.length, ...rows.map((r) => r[col]!.length));
    fixedWidth += w + COLUMN_GAP;
  }
  const columns = process.stdout.columns ?? 100;
  const budget = Math.max(MIN_FLEX_WIDTH, columns - fixedWidth);
  const clamped = rows.map((r) =>
    r.map((cell, col) =>
      col === flexCol ? truncate(collapse(cell), budget) : cell,
    ),
  );
  return renderTable([[...header], ...clamped]);
}
