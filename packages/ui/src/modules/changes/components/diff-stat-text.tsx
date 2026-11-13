export function DiffStatText({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums">
      <span className="text-[#24a148] dark:text-[#42be65]">+{additions}</span>
      <span className="text-[#dc2626] dark:text-[#fa4d56]">-{deletions}</span>
    </span>
  );
}
