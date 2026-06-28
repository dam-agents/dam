import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MOCK_MODELS = [
  {
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4",
    description: "Fast and capable",
  },
  {
    id: "claude-opus-4",
    name: "Claude Opus 4",
    description: "Most intelligent",
  },
  {
    id: "claude-haiku-4",
    name: "Claude Haiku 4",
    description: "Quick and lightweight",
  },
  { id: "gpt-4o", name: "GPT-4o", description: "OpenAI multimodal" },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    description: "Google's latest",
  },
];

export function ModelSelector() {
  const [selectedId, setSelectedId] = useState(() => {
    return localStorage.getItem("platform-mock-model") ?? "claude-sonnet-4";
  });
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);

  const selected =
    MOCK_MODELS.find((m) => m.id === selectedId) ?? MOCK_MODELS[0];

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ left: rect.left, bottom: window.innerHeight - rect.top + 4 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      )
        return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelect = (id: string) => {
    setSelectedId(id);
    localStorage.setItem("platform-mock-model", id);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted/50"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate max-w-[200px]">{selected.name}</span>
        {open ? (
          <ChevronDown size={11} className="shrink-0" />
        ) : (
          <ChevronUp size={11} className="shrink-0" />
        )}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed w-[240px] rounded-lg border border-border bg-card z-[9999] shadow-lg py-1 anim-scale-in"
            style={{ left: pos.left, bottom: pos.bottom }}
          >
            {MOCK_MODELS.map((m) => {
              const active = m.id === selectedId;
              return (
                <button
                  key={m.id}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-left text-[13px] transition-colors ${
                    active
                      ? "text-foreground bg-muted/50 font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  }`}
                  onClick={() => handleSelect(m.id)}
                >
                  {active ? (
                    <Check size={12} className="shrink-0 text-foreground" />
                  ) : (
                    <span className="w-3 shrink-0" />
                  )}
                  <div>
                    <div>{m.name}</div>
                    <div className="text-[11px] text-muted-foreground font-normal">
                      {m.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
