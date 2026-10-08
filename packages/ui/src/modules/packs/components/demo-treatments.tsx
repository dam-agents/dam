import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface DemoActions {
  packId: string;
  makeThisMine: (packId: string) => void;
  backToPacks: () => void;
  walkAway: (packId: string) => void;
}

export function DemoHeaderTag() {
  return (
    <Badge
      variant="outline"
      size="sm"
      className="border-preset/30 bg-preset/10 text-preset"
    >
      Demo
    </Badge>
  );
}

export function DemoHeaderActions({ actions }: { actions: DemoActions }) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        className="text-foreground/70 hover:bg-preset/10 hover:text-foreground"
        onClick={() => actions.backToPacks()}
      >
        Back to presets
      </Button>
      <Button size="sm" onClick={() => actions.makeThisMine(actions.packId)}>
        Create agent from this preset
      </Button>
    </div>
  );
}

export const DEMO_HEADER_CLASS = "bg-preset-light border-b-preset-border";

export const DEMO_HEADER_TEXT_OVERRIDES = {
  name: "text-foreground",
  icon: "text-foreground",
  muted: "text-foreground/60",
};
