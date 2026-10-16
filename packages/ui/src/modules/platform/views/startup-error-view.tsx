import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

export function StartupErrorView() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <Callout tone="danger" className="flex max-w-[520px] flex-col gap-3 p-6">
        <div role="alert" className="flex flex-col gap-1">
          <h1 className="text-base font-semibold text-foreground">
            Could not start the app
          </h1>
          <p className="text-sm text-muted-foreground">
            Loading or signing in did not finish. Check your connection, then
            try again.
          </p>
        </div>
        <Button
          className="self-start"
          autoFocus
          onClick={() => window.location.reload()}
        >
          Try again
        </Button>
      </Callout>
    </main>
  );
}
