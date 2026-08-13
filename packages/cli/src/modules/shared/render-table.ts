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

const COLUMN_GAP = 3;
const MIN_FLEX_WIDTH = 20;

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

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
