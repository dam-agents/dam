import type { ConnectionTemplateView } from "api-server-api";

import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { ConnectionIcon } from "./connection-icon.js";

// Modal that surfaces every available template grouped by category. Picking
// one closes the chooser and hands the template up to the parent, which
// then opens the per-template create form. Mirrors the Providers page
// pattern so the two pages feel consistent.
export function ConnectionChooserDialog({
  open,
  onClose,
  templates,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  templates: readonly ConnectionTemplateView[];
  onPick: (template: ConnectionTemplateView) => void;
}) {
  const grouped = groupByCategory(templates);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[560px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add connection</DialogTitle>
          <DialogDescription>
            Pick a credential, app, or MCP server to wire up. Tokens are
            injected into outbound requests at the gateway — agents never see
            raw values.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {(["app", "mcp", "other"] as const).map((cat) => {
            const list = grouped.get(cat) ?? [];
            if (list.length === 0) return null;
            return (
              <div key={cat}>
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.05em] mb-2">
                  {categoryLabel(cat)}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {list.map((t) => (
                    <Card
                      key={t.id}
                      onClick={() => onPick(t)}
                      className="group cursor-pointer py-3 px-4 flex flex-row items-start gap-3 transition-shadow hover:shadow-md"
                    >
                      <ConnectionIcon
                        iconSlug={t.iconSlug}
                        alt={t.name}
                        size={16}
                        className="text-text-secondary mt-0.5 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-foreground transition-colors group-hover:text-primary">
                          {t.name}
                        </div>
                        {t.description && (
                          <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                            {t.description}
                          </div>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function categoryLabel(c: ConnectionTemplateView["category"]): string {
  return c === "app" ? "Apps" : c === "mcp" ? "MCP Servers" : "Custom";
}

function groupByCategory(
  templates: readonly ConnectionTemplateView[],
): Map<ConnectionTemplateView["category"], ConnectionTemplateView[]> {
  const out = new Map<
    ConnectionTemplateView["category"],
    ConnectionTemplateView[]
  >();
  for (const t of templates) {
    const list = out.get(t.category) ?? [];
    list.push(t);
    out.set(t.category, list);
  }
  return out;
}
