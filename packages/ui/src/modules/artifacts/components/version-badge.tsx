import { Badge } from "@/components/ui/badge";

export function VersionBadge({ version }: { version: number }) {
  return (
    <Badge
      size="sm"
      variant="outline"
      className="shrink-0 tabular-nums"
      title={`Version ${version}`}
    >
      v{version}
    </Badge>
  );
}
