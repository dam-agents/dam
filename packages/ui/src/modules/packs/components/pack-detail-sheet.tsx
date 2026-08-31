import {
  Close,
  ConnectionSignal,
  FlashFilled,
  Notebook,
} from "@carbon/icons-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { Pack, PackRequirement } from "../data/packs.js";

const TYPE_META: Record<
  PackRequirement["type"],
  { icon: typeof ConnectionSignal; className: string }
> = {
  connection: {
    icon: ConnectionSignal,
    className: "bg-blue-500/10 text-blue-400",
  },
  skill: {
    icon: FlashFilled,
    className: "bg-violet-500/10 text-violet-400",
  },
  "knowledge-base": {
    icon: Notebook,
    className: "bg-amber-500/10 text-amber-400",
  },
};

interface Props {
  pack: Pack | null;
  onClose: () => void;
}

export function PackDetailSheet({ pack, onClose }: Props) {
  useEffect(() => {
    if (!pack) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [pack, onClose]);

  if (!pack) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-[600px] max-h-[80vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted text-3xl">
                {pack.icon}
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {pack.category}
                </p>
                <h2 className="text-2xl font-bold tracking-tight text-foreground">
                  {pack.name}
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Close size={16} />
            </button>
          </div>

          <p className="mt-6 text-[15px] leading-relaxed text-muted-foreground">
            {pack.description}
          </p>

          <div className="mt-8">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              What&apos;s included
            </h3>
            <div className="mt-3 flex flex-col gap-2.5">
              {pack.requirements.map((req) => {
                const meta = TYPE_META[req.type];
                const Icon = meta.icon;
                return (
                  <div
                    key={req.name}
                    className="flex items-center gap-3 rounded-xl border border-border bg-muted/50 px-4 py-3"
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                        meta.className,
                      )}
                    >
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">
                        {req.name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {req.description}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold",
                        req.required
                          ? "bg-rose-500/10 text-rose-400"
                          : "bg-emerald-500/10 text-emerald-400",
                      )}
                    >
                      {req.required ? "Required" : "Optional"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-8 flex gap-3">
            <Button className="flex-1" size="lg">
              Create agent with this pack
            </Button>
            <Button variant="outline" size="lg" onClick={onClose}>
              Try demo
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
