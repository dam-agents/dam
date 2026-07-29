import { ArrowLeft } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";

/** Back-arrow header for the catalogue modal's non-browse panes. */
export function CatalogPaneHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border-light px-5 py-4">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onBack}
        aria-label="Back"
        data-testid="catalog-back"
        className="shrink-0 text-muted-foreground"
      >
        <ArrowLeft size={18} />
      </Button>
      <div>
        <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
        {subtitle && (
          <p className="mt-0.5 text-[14px] text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
