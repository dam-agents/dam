import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";

export function RootDriverSpendNote({
  root,
}: {
  root: { id: string; name: string };
}) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  return (
    <p className="text-sm text-muted-foreground">
      Its spend counts for the limits of{" "}
      <Button
        variant="link"
        size="inline"
        onClick={() => navigateToSandboxHome(root.id, "usage")}
      >
        {root.name}
      </Button>
      , the agent that started it.
    </p>
  );
}
