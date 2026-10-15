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
      This agent was started by{" "}
      <Button
        variant="link"
        size="inline"
        onClick={() => navigateToSandboxHome(root.id, "usage")}
      >
        {root.name}
      </Button>
      . Its spend counts toward the spend limits of that agent, so it has no
      limits of its own.
    </p>
  );
}
