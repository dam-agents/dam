import { Badge } from "@/components/ui/badge";

export function VersionBadge({ version }: { version: number }) {
  return (
    <Badge
      variant="outline"
      className="shrink-0 px-1.5 py-0 text-[11px] tabular-nums"
      title={`Version ${version}`}
    >
      v{version}
    </Badge>
  );
}
