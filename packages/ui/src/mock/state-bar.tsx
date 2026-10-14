import {
  ChevronLeft,
  ChevronRight,
  Cube,
  Document,
  TextFont,
  Warning,
} from "@carbon/icons-react";

import { cn } from "@/lib/utils";

import { fireApprovalToast } from "../modules/notifications/hooks/use-approval-toasts.js";
import { PACKS, REAL_PACKS } from "../modules/packs/data/packs.js";
import { useStore } from "../store.js";

const TOAST_AGENTS = [
  "CI Pipeline Agent",
  "Code Review Agent",
  "Security Scanner",
  "Build Agent",
  "Docs Sync Agent",
];

const IN_FRAME = window.self !== window.top;

export function MockStateBar() {
  if (IN_FRAME) return null;
  return <MockStateBarPanel />;
}

function MockStateBarPanel() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const openApprovals = useStore((s) => s.openApprovals);
  const kitMode = useStore((s) => s.starterKitMode);

  return (
    <>
      <button
        type="button"
        onClick={() => setView("placeholder-texts")}
        className={cn(
          "fixed bottom-4 left-[72px] z-[9999] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted",
          view === "placeholder-texts" && "bg-muted",
        )}
        aria-label="Placeholder texts"
      >
        <TextFont size={16} className="text-foreground" />
      </button>

      <button
        type="button"
        onClick={() => {
          const name =
            TOAST_AGENTS[Math.floor(Math.random() * TOAST_AGENTS.length)]!;
          const headlines = [
            "Wants to access network",
            "Wants to run a command",
          ];
          const headline =
            headlines[Math.floor(Math.random() * headlines.length)]!;
          fireApprovalToast(name, headline, openApprovals);
        }}
        className="fixed bottom-4 left-[120px] z-[9999] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted"
        aria-label="Fire approval toast"
      >
        <Warning size={16} className="text-foreground" />
      </button>

      <KitToggle kitMode={kitMode} />

      <button
        type="button"
        onClick={() => {
          if (view === "handoff-sheet") {
            useStore.setState({ view: "chat" });
          } else {
            setView("handoff-sheet");
          }
        }}
        className={cn(
          "fixed bottom-4 right-4 z-[9999] flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted",
          view === "handoff-sheet" && "bg-muted",
        )}
        aria-label="Handoff sheet"
      >
        <Document size={16} className="text-foreground" />
      </button>
    </>
  );
}

function KitToggle({ kitMode }: { kitMode: boolean }) {
  const realPacks = useStore((s) => s.realPacks);
  const selectedId = useStore((s) => s.selectedStarterKitId);
  const allPacks = realPacks ? REAL_PACKS : PACKS;
  const kits = allPacks.filter((p) => p.required.length > 0);

  const currentIdx = kits.findIndex((p) => p.id === selectedId);

  const toggle = () => {
    if (kitMode) {
      useStore.setState({ starterKitMode: false, selectedStarterKitId: null });
    } else {
      const first = kits[0];
      useStore.setState({
        starterKitMode: true,
        selectedStarterKitId: first?.id ?? null,
      });
    }
  };

  const cycle = (dir: -1 | 1) => {
    if (kits.length === 0) return;
    const next = (currentIdx + dir + kits.length) % kits.length;
    useStore.setState({ selectedStarterKitId: kits[next]!.id });
  };

  return (
    <div className="fixed bottom-4 right-[60px] z-[9999] flex items-center gap-1">
      {kitMode && kits.length > 1 && (
        <button
          type="button"
          onClick={() => cycle(-1)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted"
          aria-label="Previous kit"
        >
          <ChevronLeft size={16} className="text-foreground" />
        </button>
      )}
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "flex h-10 items-center gap-1.5 rounded-full border border-border bg-card px-3 shadow-lg transition-colors hover:bg-muted",
          kitMode && "border-preset-border/60 bg-preset-light/40",
        )}
        aria-label="Toggle starter kit mode"
      >
        <Cube size={16} className="text-foreground" />
        <span className="max-w-[140px] truncate text-sm text-foreground">
          {kitMode && currentIdx >= 0 ? kits[currentIdx]!.name : "Kit"}
        </span>
      </button>
      {kitMode && kits.length > 1 && (
        <button
          type="button"
          onClick={() => cycle(1)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card shadow-lg transition-colors hover:bg-muted"
          aria-label="Next kit"
        >
          <ChevronRight size={16} className="text-foreground" />
        </button>
      )}
    </div>
  );
}
