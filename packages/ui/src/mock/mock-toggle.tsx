import { queryClient } from "../query-client.js";
import { mockEmpty, setMockEmpty } from "./handlers.js";

export function MockToggle() {
  const toggle = () => {
    const next = !mockEmpty;
    setMockEmpty(next);
    queryClient.invalidateQueries();
  };

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-[14px] font-medium text-foreground shadow-lg transition-colors hover:bg-muted"
      >
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full ${mockEmpty ? "bg-amber-400" : "bg-green-400"}`}
        />
        {mockEmpty ? "Empty state" : "Populated"}
      </button>
    </div>
  );
}
