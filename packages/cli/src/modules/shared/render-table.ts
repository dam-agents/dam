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
