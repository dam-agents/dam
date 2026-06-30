import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CUSTOM_IMAGE_DOCS_URL } from "@/constants";
import { cn } from "@/lib/utils";

export function CustomImageCard({
  value,
  selected,
  onChange,
  onSubmit,
}: {
  value: string;
  selected: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-4",
        selected ? "border-foreground" : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        <p className="text-[16px] font-semibold text-foreground">Custom</p>
        <Badge
          variant="outline"
          className="border-transparent bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
        >
          Advanced
        </Badge>
      </div>
      <p className="mt-1 text-[14px] text-muted-foreground">
        Bring your own ACP-compatible image{" "}
        <a
          href={CUSTOM_IMAGE_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          className="text-[14px] text-muted-foreground underline underline-offset-2 hover:text-primary"
        >
          Learn more
        </a>
      </p>
      <div className="mt-3">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit();
          }}
          placeholder="ghcr.io/org/agent:latest"
          variant="monospace"
        />
      </div>
    </div>
  );
}
