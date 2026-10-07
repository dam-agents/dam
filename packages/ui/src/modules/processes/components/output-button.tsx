import { Button } from "@/components/ui/button";

export function OutputButton({
  command,
  active,
  onClick,
}: {
  command: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="xs"
      className="shrink-0 font-normal"
      aria-label={`Output of ${command}`}
      aria-pressed={active}
      onClick={onClick}
    >
      Output
    </Button>
  );
}
