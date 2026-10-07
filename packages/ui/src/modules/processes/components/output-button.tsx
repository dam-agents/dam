import { Button } from "@/components/ui/button";

export function OutputButton({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="xs"
      className="shrink-0 font-normal"
      aria-pressed={active}
      onClick={onClick}
    >
      Output
    </Button>
  );
}
